/**
 * classify-batch-test.ts
 *
 * Runs a predefined set of queries through the classify pipeline automatically
 * and saves structured results to data/test_results/.
 *
 * Usage:
 *   Dispatch only (fast):
 *     npm run test:classify:batch
 *
 *   With LLM responses (slow — requires Ollama running):
 *     npm run test:classify:batch -- --llm
 */

import * as fs from "fs";
import * as path from "path";
import dotenv from "dotenv";
import { dispatchQuery } from "../core/OasisAdapter";
import { chatWithLLMStream, resetChatHistory } from "../cloud-api/llm";
import { Message } from "../type";
import { testResultsDir } from "../utils/dir";

dotenv.config();

// ── Test cases ────────────────────────────────────────────────────────────────

interface TestCase {
    query:    string;
    expected: string;   // expected category or dispatch mode
    note?:    string;
}

const TEST_CASES: TestCase[] = [
    // Life-threatening
    { query: "my mom not breathing",               expected: "cpr",                  note: "cardiac arrest via family member" },
    { query: "someone collapsed and not breathing", expected: "cpr" },
    { query: "cpr",                                expected: "cpr",                  note: "Tier 0A keyword" },
    { query: "my friend is choking",               expected: "choking" },
    { query: "bleeding wont stop",                 expected: "bleeding" },
    { query: "my finger cut",                      expected: "bleeding",             note: "Tier 0A: 3-word query" },
    { query: "she is having a severe allergic reaction", expected: "anaphylaxis" },
    { query: "he used heroin and wont wake up",    expected: "opioid_overdose" },

    // Stroke / cardiac
    { query: "my left side of body doesn't move",  expected: "stroke",              note: "unilateral paralysis" },
    { query: "my left side of body is weak",       expected: "stroke" },
    { query: "face is drooping on one side",       expected: "stroke" },
    { query: "he is having a heart attack",        expected: "heart_attack" },

    // Trauma
    { query: "broken arm bone sticking out",       expected: "fracture" },
    { query: "shoulder dislocated",                expected: "sprain_dislocation" },
    { query: "he has a knife stuck in his chest",  expected: "impaled_object" },

    // Environmental / burns
    { query: "my finger burn",                     expected: "burns" },
    { query: "can I put peanut butter on my burn", expected: "burns",               note: "myth-busting query" },
    { query: "she was outside in the cold for hours and is shaking", expected: "hypothermia" },
    { query: "person is pale cold and sweaty after injury", expected: "shock",      note: "post-trauma shock" },

    // AED
    { query: "aed",                                expected: "cpr",                  note: "Tier 0A keyword" },
    { query: "how do i use an aed",                expected: "cpr",                  note: "Tier 0B sentence" },

    // Wildlife / wilderness
    { query: "a bear is charging at me",           expected: "bear_encounter" },
    { query: "snake bit me",                       expected: "bites_and_stings" },
    { query: "i am lost in the woods",             expected: "lost_in_wilderness" },

    // Mental health
    { query: "she is having a panic attack",       expected: "panic_attack" },
    { query: "my friend said they want to kill themselves", expected: "suicidal_crisis" },

    // OOD
    { query: "what is the weather today",          expected: "ood_response",         note: "clear OOD" },
    { query: "she looks not good what should I do", expected: "ood_response",        note: "too vague" },
];

// ── Types ─────────────────────────────────────────────────────────────────────

interface TestResult {
    query:          string;
    expected:       string;
    actual:         string;       // category or mode
    mode:           string;
    score:          number | null;
    top3:           { category: string; score: number }[];
    threshold_path: string;
    dispatch_ms:    number;
    passed:         boolean;
    llm_response?:  string;
    llm_ms?:        number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getActual(dispatch: Awaited<ReturnType<typeof dispatchQuery>>): string {
    if (dispatch.mode === "ood_response") return "ood_response";
    if (dispatch.mode === "direct_response") return "direct_response";
    return dispatch.raw.category ?? dispatch.mode;
}


// ── Runner ────────────────────────────────────────────────────────────────────

async function runBatch(withLLM: boolean): Promise<void> {
    const results: TestResult[] = [];
    let passed = 0;

    console.log(`\nOASIS Classify Batch Test — ${TEST_CASES.length} queries${withLLM ? " (+ LLM)" : ""}`);
    console.log("=".repeat(70));

    for (const tc of TEST_CASES) {
        process.stdout.write(`  ${tc.query.padEnd(48)}`);

        const t0 = Date.now();
        const dispatch = await dispatchQuery(tc.query, null);
        const dispatch_ms = Date.now() - t0;

        const actual = getActual(dispatch);
        const ok = actual === tc.expected;
        if (ok) passed++;

        const mark = ok ? "✓" : "✗";
        const scoreStr = dispatch.raw.score != null ? dispatch.raw.score.toFixed(3) : "  — ";
        process.stdout.write(`${mark}  ${actual.padEnd(22)} ${scoreStr}\n`);

        if (!ok) {
            console.log(`     expected: ${tc.expected}  top3: ${dispatch.raw.top3.map(e => `${e.category}:${e.score.toFixed(3)}`).join("  ")}`);
        }

        const result: TestResult = {
            query:          tc.query,
            expected:       tc.expected,
            actual,
            mode:           dispatch.mode,
            score:          dispatch.raw.score,
            top3:           dispatch.raw.top3,
            threshold_path: dispatch.raw.threshold_path,
            dispatch_ms,
            passed:         ok,
        };

        if (withLLM && (dispatch.mode === "llm_prompt" || dispatch.mode === "triage_prompt")) {
            const sysPrompt = dispatch.systemPrompt;
            if (sysPrompt) {
                process.stdout.write("     [LLM] ");
                const start = Date.now();
                let llmOut = "";
                resetChatHistory();
                // Await the Promise returned by chatWithLLMStream directly —
                // more reliable than relying on endCallback to resolve an outer Promise.
                await chatWithLLMStream(
                    [{ role: "system", content: sysPrompt }, { role: "user", content: tc.query }] as Message[],
                    (chunk) => { process.stdout.write(chunk); llmOut += chunk; },
                    () => {},
                    () => {},
                );
                const llm_ms = Date.now() - start;
                process.stdout.write(`\n     [${llm_ms}ms]\n`);
                result.llm_response = llmOut.trim();
                result.llm_ms = llm_ms;
            }
        }

        results.push(result);
    }

    // ── Summary ───────────────────────────────────────────────────────────────

    const failed = results.filter(r => !r.passed);
    console.log("=".repeat(70));
    console.log(`Result: ${passed}/${TEST_CASES.length} passed${failed.length ? `  —  ${failed.length} failed: ${failed.map(r => `"${r.query}"`).join(", ")}` : ""}`);

    // ── Save to file ──────────────────────────────────────────────────────────

    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const filename = `classify_batch_${ts}.json`;
    const outPath = path.join(testResultsDir, filename);

    fs.mkdirSync(testResultsDir, { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify({ timestamp: new Date().toISOString(), passed, total: TEST_CASES.length, results }, null, 2));
    console.log(`\nSaved → ${outPath}`);
}

// ── Entry point ───────────────────────────────────────────────────────────────

const withLLM = process.argv.includes("--llm");

runBatch(withLLM)
    .then(() => process.exit(0))
    .catch((err) => { console.error(err); process.exit(1); });
