import moment from "moment";
import {
  getCurrentTimeTag,
  getRecordFileDurationMs,
  splitSentences,
} from "./../utils/index";
import { noop } from "lodash";
import {
  onButtonPressed,
  onButtonReleased,
  onButtonDoubleClick,
} from "../device/display";
import { recordAudioManually, recordFileFormat } from "../device/audio";
import {
  recognizeAudio,
  chatWithLLMStream,
  ttsProcessor,
} from "../cloud-api/server";
import { StreamResponser } from "./StreamResponsor";
import { recordingsDir } from "../utils/dir";
import dotEnv from "dotenv";
import { sanitizeOasisChunk, logOasisResponse, dispatchQuery } from "./OasisAdapter";

const TRIAGE_HINT_TTL_MS = 60_000;

dotEnv.config();

class ChatFlow {
  currentFlowName: string = "";
  recordingsDir: string = "";
  currentRecordFilePath: string = "";
  asrText: string = "";
  streamResponser: StreamResponser;
  partialThinking: string = "";
  thinkingSentences: string[] = [];
  answerId: number = 0;
  private triageHint: { category: string; expiresAt: number } | null = null;

  constructor() {
    console.log(`[${getCurrentTimeTag()}] ChatBot started.`);
    this.recordingsDir = recordingsDir;
    this.setCurrentFlow("sleep");
    this.streamResponser = new StreamResponser(
      ttsProcessor,
      () => {},
      () => {},
    );
  }

  async recognizeAudio(path: string): Promise<string> {
    if ((await getRecordFileDurationMs(path)) < 500) {
      console.log("Record audio too short, skipping recognition.");
      return Promise.resolve("");
    }
    console.time(`[ASR time]`);
    const result = await recognizeAudio(path);
    console.timeEnd(`[ASR time]`);
    return result;
  }

  partialThinkingCallback = (partialThinking: string): void => {
    this.partialThinking += partialThinking;
    const { sentences, remaining } = splitSentences(this.partialThinking);
    if (sentences.length > 0) {
      this.thinkingSentences.push(...sentences);
    }
    this.partialThinking = remaining;
  };

  private getActiveTriageHint(): string | null {
    if (!this.triageHint) return null;
    if (Date.now() > this.triageHint.expiresAt) {
      this.triageHint = null;
      return null;
    }
    return this.triageHint.category;
  }

  setCurrentFlow = (flowName: string): void => {
    console.log(`[${getCurrentTimeTag()}] switch to:`, flowName);
    switch (flowName) {
      case "sleep":
        this.currentFlowName = "sleep";
        onButtonPressed(() => {
          this.setCurrentFlow("listening");
        });
        onButtonReleased(noop);
        break;
      case "listening":
        this.answerId += 1;
        this.currentFlowName = "listening";
        this.currentRecordFilePath = `${
          this.recordingsDir
        }/user-${Date.now()}.${recordFileFormat}`;
        onButtonPressed(noop);
        const { result, stop } = recordAudioManually(
          this.currentRecordFilePath,
        );
        onButtonReleased(() => {
          stop();
        });
        result
          .then(() => {
            this.setCurrentFlow("asr");
          })
          .catch((err) => {
            console.error("Error during recording:", err);
            this.setCurrentFlow("sleep");
          });
        break;
      case "asr":
        this.currentFlowName = "asr";
        onButtonDoubleClick(null);
        Promise.race([
          this.recognizeAudio(this.currentRecordFilePath),
          new Promise<string>((resolve) => {
            onButtonPressed(() => {
              resolve("[UserPress]");
            });
            onButtonReleased(noop);
          }),
        ]).then((result) => {
          if (this.currentFlowName !== "asr") return;
          if (result === "[UserPress]") {
            this.setCurrentFlow("listening");
          } else {
            if (result) {
              console.log("Audio recognized result:", result);
              this.asrText = result;
              this.setCurrentFlow("answer");
            } else {
              this.setCurrentFlow("sleep");
            }
          }
        });
        break;
      case "answer":
        this.currentFlowName = "answer";
        const currentAnswerId = this.answerId;
        onButtonPressed(() => {
          this.setCurrentFlow("listening");
        });
        onButtonReleased(noop);
        const {
          partial,
          endPartial,
          getPlayEndPromise,
          stop: stopPlaying,
        } = this.streamResponser;
        this.partialThinking = "";
        this.thinkingSentences = [];

        const capturedQuery = this.asrText;
        {

          dispatchQuery(capturedQuery, this.getActiveTriageHint())
            .then((dispatch) => {
              if (currentAnswerId !== this.answerId) return;

              if (dispatch.mode === "direct_response" || dispatch.mode === "ood_response") {
                this.triageHint = null;
                logOasisResponse(capturedQuery, dispatch.responseText);
                partial(dispatch.responseText);
                endPartial();

              } else if (dispatch.mode === "llm_prompt") {
                this.triageHint = null;
                const prompt: { role: "system" | "user"; content: string }[] = [
                  { role: "system", content: dispatch.systemPrompt },
                  { role: "user",   content: capturedQuery },
                ];

                const oasisBuffer: string[] = [];

                chatWithLLMStream(
                  prompt,
                  (text) => {
                    if (currentAnswerId !== this.answerId) return;
                    const clean = sanitizeOasisChunk(text);
                    oasisBuffer.push(clean);
                    partial(clean);
                  },
                  () => {
                    if (currentAnswerId !== this.answerId) return;
                    const fullResponse = oasisBuffer.join("");
                    logOasisResponse(capturedQuery, fullResponse);
                    console.log("[OASIS] Full response:\n", fullResponse);
                    endPartial();
                  },
                  (partialThinking) =>
                    currentAnswerId === this.answerId &&
                    this.partialThinkingCallback(partialThinking),
                  () => {},
                );

              } else {
                this.triageHint = {
                  category:  dispatch.triageHint,
                  expiresAt: Date.now() + TRIAGE_HINT_TTL_MS,
                };
                if (dispatch.raw.hint_changed_result) {
                  console.log(`[Classify] hint changed result for category=${dispatch.raw.category}`);
                }
                const prompt: { role: "system" | "user"; content: string }[] = [
                  { role: "system", content: dispatch.systemPrompt },
                  { role: "user",   content: capturedQuery },
                ];

                const oasisBuffer: string[] = [];

                chatWithLLMStream(
                  prompt,
                  (text) => {
                    if (currentAnswerId !== this.answerId) return;
                    const clean = sanitizeOasisChunk(text);
                    oasisBuffer.push(clean);
                    partial(clean);
                  },
                  () => {
                    if (currentAnswerId !== this.answerId) return;
                    const fullResponse = oasisBuffer.join("");
                    logOasisResponse(capturedQuery, fullResponse);
                    console.log("[OASIS] Full response:\n", fullResponse);
                    endPartial();
                  },
                  (partialThinking) =>
                    currentAnswerId === this.answerId &&
                    this.partialThinkingCallback(partialThinking),
                  () => {},
                );
              }
            });
        }
        getPlayEndPromise().then(() => {
          if (this.currentFlowName === "answer") {
            this.setCurrentFlow("sleep");
          }
        });
        onButtonPressed(() => {
          stopPlaying();
          this.setCurrentFlow("listening");
        });
        onButtonReleased(noop);
        break;
      default:
        console.error("Unknown flow name:", flowName);
        break;
    }
  };
}

export default ChatFlow;
