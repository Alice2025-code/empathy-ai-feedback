export default async function handler(req, res) {
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
  "feedback": "string",
  "examples": ["string", "string"],
  "detectedEmotion": "string",
  "rewriteSuggestion": "string"
}
Keep tone friendly and encouraging. No markdown.
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

    // result is guaranteed defined here
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({
      error: "Server error",
      details: String(err),
    });
  }
}
