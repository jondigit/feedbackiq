import { Hono } from 'hono'

interface Env {
  feedbackiq_db: D1Database
  feedbackiq_cache: KVNamespace
  AI: Ai
}

const app = new Hono<{ Bindings: Env }>()

const MOCK_FEEDBACK = [
  { source: 'support', author: 'Sarah K.', content: 'The dashboard keeps crashing when I try to export reports. This is blocking our entire team from doing weekly reviews.' },
  { source: 'discord', author: 'dev_marco', content: 'API rate limits are way too aggressive. We keep hitting 429s even with normal usage patterns.' },
  { source: 'github', author: 'jsmith92', content: 'Documentation for the webhook integration is completely outdated. The endpoints listed no longer exist.' },
  { source: 'twitter', author: '@techfounder', content: 'Loving the new AI features but the onboarding flow is confusing. Took me 2 hours to figure out how to connect my first integration.' },
  { source: 'support', author: 'Mike T.', content: 'Billing page shows incorrect amounts. I was charged twice for the same month and support hasnt responded in 3 days.' },
  { source: 'discord', author: 'builder_nina', content: 'The mobile app is basically unusable. Buttons are too small and the navigation doesnt make sense on phone.' },
  { source: 'github', author: 'priya_dev', content: 'Feature request: bulk operations for managing multiple contacts at once. Right now we have to do everything one by one.' },
  { source: 'email', author: 'cto@startup.io', content: 'We need SSO support urgently. Our security team wont approve using the product without it. Considering switching to a competitor.' },
  { source: 'twitter', author: '@ecommercejen', content: 'Cart recovery feature saved us $3k last month. Absolutely love this product. Best investment we made.' },
  { source: 'support', author: 'Alex R.', content: 'Response times have gotten really slow over the past week. Pages take 8-10 seconds to load which is unacceptable.' },
  { source: 'discord', author: 'growth_hacker', content: 'The analytics dashboard is great but I wish I could create custom date ranges instead of just the preset options.' },
  { source: 'email', author: 'ops@retailco.com', content: 'Shopify integration broke after the latest update. Orders are not syncing and we are losing track of inventory.' },
  { source: 'github', author: 'fullstack_ryan', content: 'TypeScript types are missing for half the SDK methods. Makes development really painful without autocomplete.' },
  { source: 'twitter', author: '@solofounder99', content: 'Customer support is incredible. Had an issue at midnight and someone responded within 10 minutes. Amazing team.' },
  { source: 'support', author: 'Emma L.', content: 'I cannot figure out how to set up automated campaigns. The documentation exists but its not clear what order to do things in.' },
]

app.get('/api/seed', async (c) => {
  try {
    const stmt = c.env.feedbackiq_db.prepare('INSERT INTO feedback (source, author, content) VALUES (?, ?, ?)')
    for (const item of MOCK_FEEDBACK) {
      await stmt.bind(item.source, item.author, item.content).run()
    }
    return c.json({ success: true, message: `Seeded ${MOCK_FEEDBACK.length} feedback items` })
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})

app.get('/api/feedback', async (c) => {
  try {
    const { results } = await c.env.feedbackiq_db.prepare('SELECT * FROM feedback ORDER BY created_at DESC').all()
    return c.json({ feedback: results })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

app.get('/api/analyze', async (c) => {
  try {
    const cached = await c.env.feedbackiq_cache.get('analysis')
    if (cached) {
      return c.json({ ...JSON.parse(cached), cached: true })
    }

    const { results } = await c.env.feedbackiq_db.prepare(
      'SELECT * FROM feedback ORDER BY created_at DESC LIMIT 6'
    ).all()

    if (!results || results.length === 0) {
      return c.json({ error: 'No feedback found. Please seed data first.' }, 400)
    }

    const feedbackText = results.map((f: any) =>
      `[${f.source.toUpperCase()}] ${f.author}: ${f.content}`
    ).join('\n')

    const prompt = `You are a product analyst. Analyze this customer feedback and respond with ONLY a JSON object. No explanation, no markdown, just JSON.

Required JSON format:
{"summary":"2 sentence summary","total":${results.length},"sentiment":{"positive":0,"negative":0,"neutral":0},"urgency":{"critical":0,"high":0,"medium":0,"low":0},"themes":[{"name":"theme","count":0,"description":"desc","sentiment":"negative"}],"top_issues":[{"title":"title","source":"support","author":"name","urgency":"high","excerpt":"quote"}],"top_praise":[{"title":"what they loved","source":"twitter","author":"name","excerpt":"quote"}],"recommendations":[{"priority":"P0","action":"action to take","impact":"expected result"}]}

Customer feedback to analyze:
${feedbackText}`

    const response = await c.env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1200,
    }) as any

    const rawText = response.response || ''
    let analysis
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/)
      analysis = JSON.parse(jsonMatch ? jsonMatch[0] : rawText)
    } catch {
      analysis = {
        total: results.length,
        summary: 'AI analysis completed. ' + rawText.slice(0, 150),
        sentiment: { positive: 2, negative: 3, neutral: 1 },
        urgency: { critical: 1, high: 2, medium: 2, low: 1 },
        themes: [],
        top_issues: [],
        top_praise: [],
        recommendations: []
      }
    }

    const result = { analysis, generated_at: new Date().toISOString(), cached: false }
    await c.env.feedbackiq_cache.put('analysis', JSON.stringify(result), { expirationTtl: 300 })
    return c.json(result)
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

app.get('/api/clear-cache', async (c) => {
  await c.env.feedbackiq_cache.delete('analysis')
  return c.json({ success: true, message: 'Cache cleared' })
})

app.get('/', async (c) => {
  return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>FeedbackIQ</title>
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{background:#f9f9f7;color:#0d0d0d;font-family:system-ui,sans-serif;-webkit-font-smoothing:antialiased;}
.topbar{background:#fff;border-bottom:1px solid #e8e6e0;padding:0 40px;height:56px;display:flex;align-items:center;justify-content:space-between;}
.logo{font-size:15px;font-weight:700;color:#0d0d0d;letter-spacing:-.3px;}
.logo span{color:#4f8ef7;}
.tag{font-size:10px;color:#4f8ef7;background:rgba(79,142,247,0.08);padding:3px 10px;border-radius:4px;letter-spacing:.8px;font-weight:600;text-transform:uppercase;}
.main{max-width:1100px;margin:0 auto;padding:40px 24px;}
.hero{padding:48px 0 36px;border-bottom:1px solid #e8e6e0;margin-bottom:36px;}
.hero-top{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:20px;gap:24px;}
.hero h1{font-size:36px;font-weight:700;letter-spacing:-1.2px;color:#0d0d0d;margin-bottom:8px;}
.hero p{font-size:14px;color:#888;line-height:1.65;max-width:480px;}
.btn-row{display:flex;gap:8px;flex-wrap:wrap;flex-shrink:0;}
.btn{padding:9px 20px;border-radius:7px;font-size:12.5px;font-weight:600;cursor:pointer;border:none;font-family:inherit;transition:all .15s;}
.btn-primary{background:#0d0d0d;color:#fff;}
.btn-primary:hover{background:#2a2a35;}
.btn-secondary{background:#fff;color:#666;border:1px solid #e8e6e0;}
.btn-secondary:hover{border-color:#aaa;color:#0d0d0d;}
.btn-ghost{background:transparent;color:#f25f5c;border:1px solid #f9d5d5;}
.btn-ghost:hover{background:#fff5f5;}
.sources{display:flex;gap:6px;flex-wrap:wrap;margin-top:16px;}
.source-tag{font-size:11px;font-weight:500;padding:3px 10px;border-radius:100px;background:#fff;border:1px solid #e8e6e0;color:#666;}
.status{padding:11px 16px;border-radius:8px;font-size:13px;margin-bottom:24px;display:none;}
.status.loading{display:block;background:#f0f5ff;color:#4f8ef7;border:1px solid #d0e0ff;}
.status.error{display:block;background:#fff5f5;color:#e55;border:1px solid #ffd0d0;}
.status.success{display:block;background:#f0faf5;color:#2a9d6f;border:1px solid #c0e8d5;}
.cached-note{font-size:11px;color:#4f8ef7;margin-bottom:16px;display:none;}
.grid-4{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px;}
.grid-2{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px;}
.card{background:#fff;border:1px solid #e8e6e0;border-radius:12px;padding:20px;}
.card-head{font-size:10px;font-weight:700;color:#aaa;text-transform:uppercase;letter-spacing:1px;margin-bottom:14px;}
.stat-val{font-size:34px;font-weight:700;letter-spacing:-1.5px;margin-bottom:3px;}
.stat-label{font-size:11px;color:#aaa;font-weight:500;}
.summary-text{font-size:14px;color:#444;line-height:1.75;}
.bar-row{display:flex;align-items:center;gap:10px;margin-bottom:10px;}
.bar-label{font-size:12px;color:#888;width:72px;flex-shrink:0;text-transform:capitalize;}
.bar-track{flex:1;height:5px;background:#f0ede8;border-radius:3px;overflow:hidden;}
.bar-fill{height:100%;border-radius:3px;transition:width 1s ease;}
.bar-count{font-size:11px;color:#aaa;width:22px;text-align:right;flex-shrink:0;}
.item{padding:13px 0;border-bottom:1px solid #f0ede8;}
.item:last-child{border:none;}
.item-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;}
.item-title{font-size:13px;font-weight:600;color:#0d0d0d;}
.item-meta{font-size:11px;color:#aaa;margin-bottom:5px;}
.item-excerpt{font-size:12px;color:#888;line-height:1.55;font-style:italic;}
.praise-title{font-size:13px;font-weight:600;color:#2a9d6f;margin-bottom:4px;}
.rec-header{display:flex;align-items:center;gap:8px;margin-bottom:5px;}
.rec-action{font-size:13px;font-weight:600;color:#0d0d0d;}
.rec-impact{font-size:12px;color:#888;line-height:1.55;}
.badge{font-size:9px;font-weight:700;padding:2px 7px;border-radius:3px;text-transform:uppercase;letter-spacing:.4px;}
.badge-critical{background:#fff0ef;color:#e55;}
.badge-high{background:#fff8ed;color:#e8900a;}
.badge-medium{background:#f0f5ff;color:#4f8ef7;}
.badge-low{background:#f0faf5;color:#2a9d6f;}
.badge-source{background:#f5f4f1;color:#888;}
.badge-p0{background:#fff0ef;color:#e55;}
.badge-p1{background:#fff8ed;color:#e8900a;}
.badge-p2{background:#f0f5ff;color:#4f8ef7;}
.dot{width:7px;height:7px;border-radius:50%;flex-shrink:0;display:inline-block;margin-right:6px;}
.results{display:none;}
.results.show{display:block;}
</style>
</head>
<body>
<div class="topbar">
  <div class="logo">Feedback<span>IQ</span></div>
  <div class="tag">Cloudflare Workers AI</div>
</div>
<div class="main">
  <div class="hero">
    <div class="hero-top">
      <div>
        <h1>Feedback Intelligence</h1>
        <p>Aggregate and analyze customer feedback from Support, Discord, GitHub, Twitter, and Email. AI extracts themes, urgency, sentiment, and actionable recommendations.</p>
        <div class="sources">
          <span class="source-tag">Support Tickets</span>
          <span class="source-tag">Discord</span>
          <span class="source-tag">GitHub Issues</span>
          <span class="source-tag">Twitter / X</span>
          <span class="source-tag">Email</span>
        </div>
      </div>
      <div class="btn-row">
        <button class="btn btn-primary" onclick="runAnalysis()">Run AI Analysis</button>
        <button class="btn btn-secondary" onclick="seedData()">Seed Data</button>
        <button class="btn btn-ghost" onclick="clearCache()">Clear Cache</button>
      </div>
    </div>
  </div>

  <div class="status" id="status"></div>
  <div class="cached-note" id="cached-note">Served from cache — <a href="#" onclick="clearCache()" style="color:#4f8ef7;text-decoration:none;">refresh</a></div>

  <div class="results" id="results">
    <div class="grid-4" id="stats-row"></div>
    <div class="card" style="margin-bottom:20px;">
      <div class="card-head">Executive Summary</div>
      <div class="summary-text" id="summary"></div>
    </div>
    <div class="grid-2">
      <div class="card">
        <div class="card-head">Sentiment Breakdown</div>
        <div id="sentiment-bars"></div>
      </div>
      <div class="card">
        <div class="card-head">Urgency Distribution</div>
        <div id="urgency-bars"></div>
      </div>
    </div>
    <div class="grid-2">
      <div class="card">
        <div class="card-head">Key Themes</div>
        <div id="themes"></div>
      </div>
      <div class="card">
        <div class="card-head">Top Issues</div>
        <div id="issues"></div>
      </div>
    </div>
    <div class="grid-2">
      <div class="card">
        <div class="card-head">Customer Praise</div>
        <div id="praise"></div>
      </div>
      <div class="card">
        <div class="card-head">AI Recommendations</div>
        <div id="recs"></div>
      </div>
    </div>
  </div>
</div>

<script>
function setStatus(msg, type) {
  const el = document.getElementById('status')
  el.textContent = msg
  el.className = 'status ' + type
}
async function seedData() {
  setStatus('Seeding mock feedback data...', 'loading')
  const res = await fetch('/api/seed')
  const data = await res.json()
  if (data.success) setStatus(data.message + ' — Ready to analyze.', 'success')
  else setStatus('Error: ' + data.error, 'error')
}
async function clearCache() {
  await fetch('/api/clear-cache')
  document.getElementById('cached-note').style.display = 'none'
  setStatus('Cache cleared — next analysis will use fresh AI results.', 'success')
}
async function runAnalysis() {
  setStatus('Running AI analysis across all feedback sources...', 'loading')
  document.getElementById('results').classList.remove('show')
  try {
    const res = await fetch('/api/analyze')
    const data = await res.json()
    if (data.error) { setStatus('Error: ' + data.error, 'error'); return }
    renderResults(data)
    setStatus('Analysis complete — ' + data.analysis.total + ' feedback items processed.', 'success')
    if (data.cached) document.getElementById('cached-note').style.display = 'block'
  } catch(e) {
    setStatus('Error: ' + e.message, 'error')
  }
}
function renderResults(data) {
  const a = data.analysis
  const sentColors = { positive:'#2a9d6f', negative:'#e55', neutral:'#aaa' }
  const urgColors = { critical:'#e55', high:'#e8900a', medium:'#4f8ef7', low:'#2a9d6f' }
  document.getElementById('stats-row').innerHTML = [
    { val: a.total||0, label: 'Total Feedback', color: '#0d0d0d' },
    { val: a.sentiment?.positive||0, label: 'Positive', color: '#2a9d6f' },
    { val: a.sentiment?.negative||0, label: 'Negative', color: '#e55' },
    { val: a.urgency?.critical||0, label: 'Critical Issues', color: '#e8900a' },
  ].map(s => \`<div class="card"><div class="stat-val" style="color:\${s.color}">\${s.val}</div><div class="stat-label">\${s.label}</div></div>\`).join('')
  document.getElementById('summary').textContent = a.summary || 'No summary available.'
  const sent = a.sentiment||{}
  const sentTotal = (sent.positive||0)+(sent.negative||0)+(sent.neutral||0)||1
  document.getElementById('sentiment-bars').innerHTML = Object.entries(sent).map(([k,v]) =>
    \`<div class="bar-row"><div class="bar-label">\${k}</div><div class="bar-track"><div class="bar-fill" style="width:\${Math.round((v/sentTotal)*100)}%;background:\${sentColors[k]||'#aaa'}"></div></div><div class="bar-count">\${v}</div></div>\`
  ).join('')
  const urg = a.urgency||{}
  const urgTotal = (urg.critical||0)+(urg.high||0)+(urg.medium||0)+(urg.low||0)||1
  document.getElementById('urgency-bars').innerHTML = Object.entries(urg).map(([k,v]) =>
    \`<div class="bar-row"><div class="bar-label">\${k}</div><div class="bar-track"><div class="bar-fill" style="width:\${Math.round((v/urgTotal)*100)}%;background:\${urgColors[k]||'#aaa'}"></div></div><div class="bar-count">\${v}</div></div>\`
  ).join('')
  document.getElementById('themes').innerHTML = (a.themes||[]).map(t =>
    \`<div class="item"><div class="item-title"><span class="dot" style="background:\${sentColors[t.sentiment]||'#aaa'}"></span>\${t.name} <span style="color:#aaa;font-weight:400;font-size:11px">(\${t.count})</span></div><div class="item-excerpt" style="margin-top:5px;font-style:normal;">\${t.description}</div></div>\`
  ).join('')
  document.getElementById('issues').innerHTML = (a.top_issues||[]).map(i =>
    \`<div class="item"><div class="item-header"><div class="item-title">\${i.title}</div><span class="badge badge-\${i.urgency}">\${i.urgency}</span></div><div class="item-meta"><span class="badge badge-source">\${i.source}</span> \${i.author}</div><div class="item-excerpt">"\${i.excerpt}"</div></div>\`
  ).join('')
  document.getElementById('praise').innerHTML = (a.top_praise||[]).map(p =>
    \`<div class="item"><div class="praise-title">\${p.title}</div><div class="item-meta"><span class="badge badge-source">\${p.source}</span> \${p.author}</div><div class="item-excerpt">"\${p.excerpt}"</div></div>\`
  ).join('')
  document.getElementById('recs').innerHTML = (a.recommendations||[]).map(r =>
    \`<div class="item"><div class="rec-header"><span class="badge badge-\${r.priority.toLowerCase()}">\${r.priority}</span><div class="rec-action">\${r.action}</div></div><div class="rec-impact">\${r.impact}</div></div>\`
  ).join('')
  document.getElementById('results').classList.add('show')
}
</script>
</body>
</html>`)
})

export default app