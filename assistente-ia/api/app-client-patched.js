import { readFileSync } from 'node:fs';

const ORIGINAL_APP = readFileSync(new URL('../app.js', import.meta.url), 'utf8');

const ONESIGNAL_LEAD_HOOK = `\n;(() => {\n  const installLeadAlert = () => {\n    const button = document.getElementById('sendLead');\n    if (!button || button.dataset.leadAlertHook === '1') return;\n    button.dataset.leadAlertHook = '1';\n\n    button.addEventListener('click', () => {\n      try {\n        const target = new URL(button.href, location.href);\n        const text = target.searchParams.get('text') || '';\n        if (!text.startsWith('Nova lead - Assistente IA')) return;\n\n        fetch('/api/notify-lead', {\n          method: 'POST',\n          headers: { 'Content-Type': 'application/json' },\n          keepalive: true,\n          body: JSON.stringify({ text })\n        }).catch(() => {});\n      } catch {}\n    });\n  };\n\n  if (document.readyState === 'loading') {\n    document.addEventListener('DOMContentLoaded', installLeadAlert, { once: true });\n  } else {\n    installLeadAlert();\n  }\n})();\n`;

export default function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.status(405).end('Use GET.');
    return;
  }

  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
  res.status(200).end(req.method === 'HEAD' ? '' : ORIGINAL_APP + ONESIGNAL_LEAD_HOOK);
}
