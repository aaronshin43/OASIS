import { noop } from "lodash";
import dotenv from "dotenv";
import {
  ASRServer,
  LLMServer,
  TTSServer,
} from "../type";
import { chatWithLLMStream, resetChatHistory } from "./llm";
import { recognizeAudio as VoskASR } from "./local/vosk-asr";
import { recognizeAudio as WisperASR } from "./local/whisper-asr";
import { recognizeAudio as WisperHttpASR } from "./local/whisper-http-asr";
import { recognizeAudio as LLM8850WhisperASR } from "./local/llm8850-whisper";
import { recognizeAudio as FasterWhisperASR } from "./local/faster-whisper-asr";
import piperTTS from "./local/piper-tts";
import piperHttpTTS from "./local/piper-http-tts";
import LLM8850MeloTTS from "./local/llm8850-melotts";
import {
  RecognizeAudioFunction,
  TTSProcessorFunction,
} from "./interface";

dotenv.config();

let recognizeAudio: RecognizeAudioFunction = noop as any;
let ttsProcessor: TTSProcessorFunction = noop as any;

export const asrServer: ASRServer = (
  process.env.ASR_SERVER || ASRServer.fasterwhisper
).toLowerCase() as ASRServer;
export const llmServer: LLMServer = (
  process.env.LLM_SERVER || LLMServer.ollama
).toLowerCase() as LLMServer;
export const ttsServer: TTSServer = (
  process.env.TTS_SERVER || TTSServer.piper
).toLowerCase() as TTSServer;

console.log(`Current ASR Server: ${asrServer}`);
console.log(`Current LLM Server: ${llmServer}`);
console.log(`Current TTS Server: ${ttsServer}`);

switch (asrServer) {
  case ASRServer.vosk:
    recognizeAudio = VoskASR;
    break;
  case ASRServer.whisper:
    recognizeAudio = WisperASR;
    break;
  case ASRServer.whisperhttp:
    recognizeAudio = WisperHttpASR;
    break;
  case ASRServer.llm8850whisper:
    recognizeAudio = LLM8850WhisperASR;
    break;
  case ASRServer.fasterwhisper:
    recognizeAudio = FasterWhisperASR;
    break;
  default:
    console.warn(
      `unknown asr server: ${asrServer}, should be vosk/whisper/whisper-http/llm8850whisper/fasterwhisper`,
    );
    break;
}

switch (ttsServer) {
  case TTSServer.piper:
    ttsProcessor = piperTTS;
    break;
  case TTSServer.llm8850melotts:
    ttsProcessor = LLM8850MeloTTS;
    break;
  case TTSServer.piperhttp:
    ttsProcessor = piperHttpTTS;
    break;
  default:
    console.warn(
      `unknown tts server: ${ttsServer}, should be piper/piper-http/llm8850melotts`,
    );
    break;
}

export {
  recognizeAudio,
  chatWithLLMStream,
  ttsProcessor,
  resetChatHistory,
};
