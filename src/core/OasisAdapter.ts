/**
 * OasisAdapter.ts
 *
 * Bridges the oasis-classify service (:5002) with the ChatFlow LLM pipeline.
 */

import * as fs from "fs";
import * as path from "path";
import moment from "moment";
import {
    dispatch,
    DispatchResult,
} from "../cloud-api/local/oasis-classify-client";
import { oasisLogDir } from "../utils/dir";

// Safe fallbacks

const SAFE_FALLBACK_TEXT =
    "I am a first-aid assistant. I could not process your request right now. " +
    "If this is an emergency, please call your local emergency services immediately.";

const SAFE_FALLBACK_PROMPT = `You are OASIS, an offline first-aid assistant.
Tell the user clearly and calmly:
1. Call emergency services immediately (local emergency number).
2. Stay on the line with the dispatcher; they will guide you.
3. Do not leave the person alone.`;

// Streaming chunk sanitizer

/**
 * Strip markdown formatting characters from LLM streaming token chunks.
 * Normalize unicode punctuation before it reaches TTS so speech stays stable.
 */
export const sanitizeOasisChunk = (chunk: string): string =>
    chunk
        .replace(/\*+/g, "")
        .replace(/`+/g, "")
        .replace(/[—–]/g, "; ")
        .replace(/^#+\s*/gm, "");

// Response logger

/**
 * Write a structured JSONL entry to data/oasis_logs/ for every completed OASIS response.
 * Allows offline analysis of hallucination patterns and format compliance.
 */
export const logOasisResponse = (query: string, response: string): void => {
    try {
        const entry = JSON.stringify({
            ts: moment().toISOString(),
            query,
            response,
            steps: (response.match(/^\d+\./gm) ?? []).length,
            has_markdown: /[*_#`]/.test(response),
        });
        const logFile = path.join(oasisLogDir, `oasis_${moment().format("YYYY-MM-DD")}.jsonl`);
        fs.appendFileSync(logFile, entry + "\n", "utf8");
    } catch {
        // logging failure must never affect the response path
    }
};

// Classify dispatch

/**
 * Discriminated union representing all four dispatch modes from oasis-classify.
 * The shape of each variant guarantees the fields that are always present for that mode.
 */
export type OasisDispatch =
    | { mode: "direct_response"; responseText: string;  systemPrompt: null;   category: null;   triageHint: null;   raw: DispatchResult }
    | { mode: "ood_response";    responseText: string;  systemPrompt: null;   category: null;   triageHint: null;   raw: DispatchResult }
    | { mode: "llm_prompt";      responseText: null;    systemPrompt: string; category: null;   triageHint: null;   raw: DispatchResult }
    | { mode: "triage_prompt";   responseText: null;    systemPrompt: string; category: string; triageHint: string; raw: DispatchResult };

/**
 * Call the classify service and return a strongly-typed OasisDispatch.
 *
 * Always resolves; on failure the classify client already returns a safe
 * ood_response fallback, so this function never needs its own try/catch.
 *
 * @param query           The user's raw utterance from ASR.
 * @param prevTriageHint  Active triage category from previous turn, or null.
 * @returns               OasisDispatch; one of four mode variants.
 */
export async function dispatchQuery(
    query: string,
    prevTriageHint: string | null,
): Promise<OasisDispatch> {
    const raw = await dispatch(query, prevTriageHint);

    // Telemetry log; one line per call
    console.log(
        `[Classify] mode=${raw.mode} category=${raw.category ?? "null"} ` +
        `score=${raw.score?.toFixed(2) ?? "null"} path=${raw.threshold_path} ` +
        `latency=${raw.latency_ms.toFixed(1)}ms hint_changed=${raw.hint_changed_result}`,
    );

    switch (raw.mode) {
        case "direct_response":
            return {
                mode:         "direct_response",
                responseText: raw.response_text ?? SAFE_FALLBACK_TEXT,
                systemPrompt: null,
                category:     null,
                triageHint:   null,
                raw,
            };

        case "ood_response":
            return {
                mode:         "ood_response",
                responseText: raw.response_text ?? SAFE_FALLBACK_TEXT,
                systemPrompt: null,
                category:     null,
                triageHint:   null,
                raw,
            };

        case "llm_prompt":
            return {
                mode:         "llm_prompt",
                responseText: null,
                systemPrompt: raw.system_prompt ?? SAFE_FALLBACK_PROMPT,
                category:     null,
                triageHint:   null,
                raw,
            };

        case "triage_prompt":
            return {
                mode:         "triage_prompt",
                responseText: null,
                systemPrompt: raw.system_prompt ?? SAFE_FALLBACK_PROMPT,
                // category is always set by Python for triage_prompt
                category:     raw.category ?? "",
                triageHint:   raw.category ?? "",
                raw,
            };
    }
}
