// Anthropic APIを安全にサーバー側で呼び出すプロキシ関数
// APIキーは Netlify の環境変数 ANTHROPIC_API_KEY に設定する

exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'ANTHROPIC_API_KEY が設定されていません。Netlify の環境変数を確認してください。' }),
    };
  }

  try {
    const { base64, mediaType } = JSON.parse(event.body || '{}');
    if (!base64 || !mediaType) {
      return { statusCode: 400, body: JSON.stringify({ error: 'base64 と mediaType が必要です' }) };
    }

    const isPDF = mediaType === 'application/pdf';
    const prompt = `この不動産物件資料（募集図面・重要事項説明書・賃貸借契約書等）から初期費用の情報を抽出してください。
必ずJSONのみで返答してください。説明文・前置き・コードブロックは一切不要です。

出力フォーマット:
{"propName":"物件名（マンション名・部屋番号を含む）","moveIn":"入居日YYYY-MM-DD形式、不明はnull","monthly":[{"name":"項目名","amt":"金額数字のみ"}],"other":[{"name":"項目名","amt":"金額数字のみ","note":"備考"}]}

抽出ルール:
- monthly: 家賃・共益費・管理費・駐車場代・月額保証料など毎月発生する費用のみ
- other: 敷金・礼金・仲介手数料・初回保証料・火災保険料・鍵交換費・消毒費など契約時・入居時の一時費用のみ
- 退去時（クリーニング・エアコン洗浄等）・更新時の費用は除外
- 敷金礼金が「1ヶ月」等の場合は家賃×月数で円換算
- 金額が範囲の場合は低い方をamtに、noteに範囲を明記
- 「なし」はamt="0"、記載なし項目は配列に含めない
- JSONのみ出力`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        messages: [{
          role: 'user',
          content: [
            {
              type: isPDF ? 'document' : 'image',
              source: { type: 'base64', media_type: mediaType, data: base64 },
            },
            { type: 'text', text: prompt },
          ],
        }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Anthropic API エラー ${response.status}: ${errText.slice(0, 300)}`);
    }

    const data = await response.json();
    const text = (data.content || [])
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join('');

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ text }),
    };

  } catch (err) {
    console.error('Extract error:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: err.message || '不明なエラー' }),
    };
  }
};
