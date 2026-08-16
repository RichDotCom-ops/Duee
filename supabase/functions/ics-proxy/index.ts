const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS });
  }

  try {
    const { url } = await req.json();

    if (!url || typeof url !== 'string' || !url.startsWith('http')) {
      return new Response(JSON.stringify({ error: 'Invalid URL' }), {
        status: 400,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const upstream = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; duee-app/1.0)',
        'Accept': 'text/calendar, text/plain, */*',
      },
    });

    const text = await upstream.text();

    return new Response(text, {
      status: upstream.status,
      headers: {
        ...CORS,
        'Content-Type': 'text/calendar; charset=utf-8',
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
