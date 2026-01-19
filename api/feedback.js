export default async function handler(req, res) {
  // ✅ CORS (for browser-based Storyline fetch)
  // For a demo, "*" is fine. If you want to restrict later, replace "*" with:
  // "https://empathy-storyline-test.vercel.app"
  res.setHeader("Access-Control-Allow-Origin", "https://empathy-storyline-test.vercel.app");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // ✅ Preflight request (browser will send this before POST)
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // Allow POST only
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST with JSON body." });
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
  "detectedEmotion": "string",
  "coachingMessage": "string"
}

Rules for coachingMessage:
- ONE short coaching paragraph (friendly, coach-like).
- If overall is pass: include ONE sentence that starts with "You could also say: " followed by ONE complete example.
- If overall is needs_work: include ONE sentence that starts with "You could say: " followed by ONE complete example.
- Do NOT include labels like "rewriteSuggestion:" in the coachingMessage.
- No markdown.

No extra keys. No code fences.
`;

    const userPrompt = `
ScenarioId: ${scenarioId ?? null}
Channel: ${channel ?? "chat"}
Member statement: ${memberStatement}
Learner response: ${learnerResponse}
`;

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
          { role: "system", content: systemPrompt.trim() },
          { role: "user", content: userPrompt.trim() },
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

    let result;
    try {
      result = JSON.parse(outputText);
    } catch (e) {
      return res.status(500).json({
        error: "Model did not return valid JSON.",
        raw: outputText,
      });
    }

    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({
      error: "Server error",
      details: String(err),
    });
  }
}
