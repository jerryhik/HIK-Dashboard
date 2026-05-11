const SLACK_CHANNEL = 'C0B2RR5796F';

// yy.mm.dd / yyyy.mm.dd / yyyy-mm-dd / yy-mm-dd 모두 처리
function parseDateStr(ds) {
  if (!ds) return null;
  const m = ds.match(/^(\d{2,4})[.\-](\d{1,2})[.\-](\d{1,2})/);
  if (m) {
    let y = parseInt(m[1], 10), mo = parseInt(m[2], 10), d = parseInt(m[3], 10);
    if (y < 100) y += 2000;
    const dt = new Date(y, mo - 1, d);
    return isNaN(dt.getTime()) ? null : dt;
  }
  const dt = new Date(ds);
  return isNaN(dt.getTime()) ? null : dt;
}

// KST 기준 오늘 자정 Date 객체
function kstToday() {
  const now = new Date();
  const kst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  return new Date(kst.getFullYear(), kst.getMonth(), kst.getDate());
}

// 오늘(KST)로부터 dateStr까지 며칠인지 (0 = D-day, 3 = D-3)
function daysFrom(dateStr) {
  const d = parseDateStr(dateStr);
  if (!d) return null;
  const today = kstToday();
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((target - today) / 86400000);
}

function label(days) {
  return days === 0 ? '🔴 *오늘 D-day*' : `🔔 *D-${days} 알림*`;
}

// 활성 중개건 여부 (입실 전이거나 거주 중인 건 — 이용완료 제외)
function isActive(e) {
  if (!e.startDate) return true; // 입실일 없으면 포함
  const s = parseDateStr(e.startDate);
  if (!s) return true;
  // 퇴실일이 파싱 가능하고 이미 지났으면 이용완료 → 제외
  if (e.endDate) {
    const en = parseDateStr(e.endDate);
    if (en) {
      const today = kstToday();
      if (today > new Date(en.getFullYear(), en.getMonth(), en.getDate())) return false;
    }
  }
  return true;
}

function buildMessages(entries, testMode = false) {
  const msgs = [];
  const prefix = testMode ? '🧪 *[테스트]* ' : '';
  const active = testMode ? entries.filter(isActive) : entries;

  for (const e of active) {
    const name = e.guestName || '(이름 없음)';
    const addr = e.address || '(주소 없음)';

    if (testMode) {
      // 테스트 모드: 날짜 조건 무시, 모든 활성 건 나열
      const parts = [];
      if (e.startDate) parts.push(`입실 ${e.startDate}`);
      if (e.endDate)   parts.push(`퇴실 ${e.endDate}`);
      if (e.payType === 'monthly' && e.payDay) parts.push(`매월 ${e.payDay}일 납입`);
      msgs.push(`${prefix}- ${name} / ${addr}${parts.length ? ' (' + parts.join(', ') + ')' : ''}`);
      continue;
    }

    // 1. 입실일
    if (e.startDate) {
      const d = daysFrom(e.startDate);
      if (d === 0 || d === 3) msgs.push(`${label(d)} - ${name} / ${addr} / 입실`);
    }

    // 2. 퇴실일 (날짜 파싱 가능한 경우만)
    if (e.endDate) {
      const d = daysFrom(e.endDate);
      if (d === 0 || d === 3) msgs.push(`${label(d)} - ${name} / ${addr} / 퇴실`);
    }

    // 3. 월세 납입예정일
    if (e.payType === 'monthly') {
      if (e.breakdown && e.breakdown.length) {
        for (const r of e.breakdown) {
          if (r.status === 'done' || !r.dueDate) continue;
          const d = daysFrom(r.dueDate);
          if (d === 0 || d === 3) {
            msgs.push(`${label(d)} - ${name} / ${addr} / 월세납입`);
            break;
          }
        }
      } else if (e.payDay) {
        const today = kstToday();
        for (let offset = 0; offset <= 1; offset++) {
          const payDate = new Date(today.getFullYear(), today.getMonth() + offset, e.payDay);
          const d = Math.round((payDate - today) / 86400000);
          if (d === 0 || d === 3) {
            msgs.push(`${label(d)} - ${name} / ${addr} / 월세납입`);
            break;
          }
        }
      }
    }
  }

  return msgs;
}

async function loadEntries() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.log('[loadEntries] Supabase env vars not set');
    return { entries: [], debug: { hasUrl: !!url, hasKey: !!key, error: 'env vars missing' } };
  }
  try {
    const r = await fetch(`${url}/rest/v1/app_data?key=eq.entries&select=value`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!r.ok) {
      const text = await r.text();
      console.error('[loadEntries] Supabase error:', r.status, text);
      return { entries: [], debug: { hasUrl: true, hasKey: true, status: r.status, error: text } };
    }
    const data = await r.json();
    if (!data.length || !Array.isArray(data[0].value)) {
      return { entries: [], debug: { hasUrl: true, hasKey: true, rows: data.length, error: 'no entries row' } };
    }
    return { entries: data[0].value, debug: { hasUrl: true, hasKey: true, count: data[0].value.length } };
  } catch (e) {
    console.error('[loadEntries] fetch error:', e.message);
    return { entries: [], debug: { hasUrl: true, hasKey: true, error: e.message } };
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).end();
  }

  const token = process.env.SLACK_BOT_TOKEN || process.env.Slack_bot_token;
  if (!token) {
    return res.status(500).json({ error: 'SLACK_BOT_TOKEN 환경변수가 없습니다.' });
  }
  if (!/^[\x00-\x7F]+$/.test(token)) {
    return res.status(500).json({ error: 'SLACK_BOT_TOKEN에 비ASCII 문자가 포함되어 있습니다. Vercel 환경변수를 확인해주세요.' });
  }

  const testMode = req.query?.test === 'true';

  try {
    const { entries, debug } = await loadEntries();

    const msgs = buildMessages(entries, testMode);

    if (!msgs.length) {
      return res.status(200).json({ ok: true, sent: 0, message: testMode ? '활성 중개건 없음' : '해당 날짜 조건 없음', ...(testMode && { debug }) });
    }

    const headerLine = testMode
      ? `🧪 *[테스트 알림]* 전체 활성 중개건 ${msgs.length}건`
      : null;
    const text = [headerLine, ...msgs].filter(Boolean).join('\n');

    // Slack chat.postMessage 전송
    const slackRes = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({ channel: SLACK_CHANNEL, text, mrkdwn: true }),
    });

    const slackData = await slackRes.json();
    if (!slackData.ok) {
      console.error('Slack API error:', slackData.error);
      return res.status(500).json({ error: slackData.error });
    }

    return res.status(200).json({ ok: true, sent: msgs.length, testMode, messages: msgs, ...(testMode && { debug }) });
  } catch (err) {
    console.error('slack-notify error:', err);
    return res.status(500).json({ error: err.message });
  }
};
