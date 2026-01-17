export default async function handler(req, res) {
  // Allow POST only
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST with JSON body." });
  }

 // Helper: keep only the first ~2 sentences (one complete example)
function firstTwoSentences(text) {
  const t = (text || "").trim().replace(/\s+/g, " ");
  if (!t) return "";

  // Split into sentences while keeping punctuation.
  const parts = t.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [t];

  // Take up to 2 sentences and join.
  return parts.slice(0, 2).join(" ").trim();
}

// Helper: build a complete example (prefer rewriteSuggestion; fallback to examples)
function buildCompleteExample(result) {
  const rewriteRaw = (result?.rewriteSuggestion || "").trim();

  const looksLikeGenericPraise =
    /^your response/i.test(rewriteRaw) ||
    /keep up/i.test(rewriteRaw) ||
    /great job/i.test(rewriteRaw) ||
    rewriteRaw.length < 20;

  if (rewriteRaw && !looksLikeGenericPraise) {
    // Ensure we only return ONE concise example
    return firstTwoSentences(rewriteRaw);
  }

  const examples = Array.isArray(result?.examples)
    ? result.examples.filter((x) => typeof x === "string" && x.trim().length > 0)
    : [];

  if (examples.length >= 2) {
    // Join into one complete response (then cap to 2 sentences)
    const combined = `${examples[0].trim()} ${examples[1].trim()}`.replace(/\s+/g, " ").trim();
    return firstTwoSentences(combined);
  }

  if (examples.length === 1) return firstTwoSentences(examples[0].trim());

  return "";
}

// Helper: build one learner-friendly coaching paragraph (Option A)
function buildCoachingMessage(result) {
  const feedback = (result?.feedback || "").trim();

  const scores = result?.scores || {};
  const isPerfect =
    scores.empathyFirst === 1 && scores.correctEmotion === 1 && scores.offerHelp === 1;

  const example = buildCompleteExample(result);

  let exampleLine = "";
  if (example) {
    exampleLine = isPerfect
      ? ` You could also say: ${example}`
      : ` You could say: ${example}`;
  }

  return `${feedback}${exampleLine}`.replace(/\s+/g, " ").trim();
}

  try {
    const { scenarioId, channel, memberStatement, learnerResponse } = req.body || {};

    if (!memberStatement || !learnerResponse) {
      return res.status(400).json({
        error: "Missing required fields",
        required: ["memberStatement", "learnerResponse"],
      });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Missing OPENAI_API_KEY in environment variables." });
    }

    const systemPrompt = `
You are an empathy coach for a call-center style conversation.
Evaluate the learner response on THREE criteria:
1) Empathy first: do they acknowledge the member’s feelings before problem-solving?
2) Correct emotion: do they name/reflect the right emotion intensity (e.g., frustrated vs furious; sad vs excited)?
3) Offer to help: do they move from empathy into helpful action (without over-focusing on the technical fix)?

Return ONLY valid JSON with this exact structure:
{
  "scenarioId": number|null,
  "scores": { "empathyFirst": 0|1, "correctEmotion": 0|1, "offerHelp": 0|1 },
  "overall": "pass"|"needs_work",
  "feedback": "string",
  "examples": ["string", "string"],
  "detectedEmotion": "string",
  "rewriteSuggestion": "string"
}
Guidelines:
- examples should be complete, realistic agent responses when possible.
- rewriteSuggestion should be a full improved response when the learner needs work.
Keep tone friendly and encouraging. No markdown.
`.trim();

    const userPrompt = `
ScenarioId: ${scenarioId ?? null}
Channel: ${channel ?? "chat"}
Member statement: ${memberStatement}
Learner response: ${learnerResponse}
`.trim();

    // Call OpenAI (Responses API)
    const openaiResp = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    const data = await openaiResp.json();

    if (!openaiResp.ok) {
      return res.status(500).json({
        error: "OpenAI request failed",
        details: data,
      });
    }

    // Extract text output safely
    const outputText =
      data?.output?.[0]?.content?.find((c) => c.type === "output_text")?.text ||
      data?.output_text ||
      "";

    if (!outputText) {
      return res.status(500).json({
        error: "No output_text returned from OpenAI.",
        details: data,
      });
    }

    // Parse JSON from the model
    let result;
    try {
      result = JSON.parse(outputText);
    } catch (e) {
      return res.status(500).json({
        error: "Model did not return valid JSON.",
        raw: outputText,
      });
    }

    // Add learner-friendly single paragraph (Option A)
    result.coachingMessage = buildCoachingMessage(result);

    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({
      error: "Server error",
      details: String(err),
    });
  }
}
