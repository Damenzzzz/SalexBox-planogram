import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { api, analyzePhoto, authHeaders, setConnection, setHostAuth, ApiError } from '../src/domain/api.ts';
import { createHostLink, wantsHost } from '../src/domain/host.ts';

const ORIGIN = 'https://cabinet.example';

function fakeWindow() {
  const sent: unknown[] = [];
  const parent = { postMessage: (data: unknown, origin: string) => { assert.equal(origin, ORIGIN); sent.push(data); } };
  let listener: (e: MessageEvent) => void = () => {};
  const win = {
    parent,
    location: { origin: ORIGIN },
    addEventListener: (_: 'message', fn: (e: MessageEvent) => void) => { listener = fn; },
  };
  const deliver = (data: unknown, source: unknown = parent, origin = ORIGIN) =>
    listener({ data, source, origin } as unknown as MessageEvent);
  return { win, sent, deliver };
}

const session = (token: string) => ({ type: 'studio:session', token, organizationId: 'org-1', userName: 'Ира', apiBase: '/api' });

afterEach(() => {
  setHostAuth(null);
  setConnection(null);
  globalThis.fetch = realFetch;
});
const realFetch = globalThis.fetch;

test('режим кабинета включается только параметром', () => {
  assert.equal(wantsHost('?host=salesbox'), true);
  assert.equal(wantsHost(''), false);
  assert.equal(wantsHost('?host=other'), false);
});

test('сессию берём у своего родителя с нашего адреса', async () => {
  const { win, sent, deliver } = fakeWindow();
  const link = createHostLink(win, 50);
  const waiting = link.waitSession();
  assert.deepEqual(sent, [{ type: 'studio:ready' }]);
  deliver(session('чужой адрес'), win.parent, 'https://evil.example');
  deliver(session('чужое окно'), {}, ORIGIN);
  assert.equal(link.token(), null);
  deliver(session('t1'));
  const got = await waiting;
  assert.equal(got.organizationId, 'org-1');
  assert.equal(got.apiBase, '/api');
  assert.equal(link.token(), 't1');
});

test('сессия без организации не принимается', async () => {
  const { win, deliver } = fakeWindow();
  const link = createHostLink(win, 20);
  const waiting = link.waitSession();
  deliver({ type: 'studio:session', token: 't1' });
  await assert.rejects(waiting, /не передал сессию/);
});

test('новый токен просим один раз на пачку запросов', async () => {
  const { win, sent, deliver } = fakeWindow();
  const link = createHostLink(win, 50);
  const a = link.refresh();
  const b = link.refresh();
  deliver(session('t2'));
  assert.deepEqual(await Promise.all([a, b]), ['t2', 't2']);
  assert.equal(sent.filter(m => (m as { type: string }).type === 'studio:token-expired').length, 1);
});

test('кабинет не ответил на обновление — токена нет', async () => {
  const { win, deliver } = fakeWindow();
  const link = createHostLink(win, 10);
  const waiting = link.waitSession();
  deliver(session('t1'));
  await waiting;
  assert.equal(await link.refresh(), null);
  assert.equal(link.token(), null);
});

test('в кабинете запрос идёт с токеном, без ключа и без клиента', async () => {
  setConnection({ key: 'секрет', client: 'pmi', name: 'Ира' });
  setHostAuth({ base: '/api', token: () => 't1', refresh: async () => null });
  assert.deepEqual(authHeaders(), { Authorization: 'Bearer t1' });
  const calls: [string, RequestInit][] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push([url, init]);
    return new Response('{"ok":true}', { status: 200 });
  }) as typeof fetch;
  await api({}, '/v1/planograms');
  assert.equal(calls[0][0], '/api/v1/planograms');
  const headers = calls[0][1].headers as Record<string, string>;
  assert.equal(headers.Authorization, 'Bearer t1');
  assert.equal(headers['X-API-Key'], undefined);
  assert.equal(headers['X-Client-Id'], undefined);
  assert.equal(calls[0][1].credentials, 'omit');
});

test('401: токен обновляется, запрос повторяется один раз', async () => {
  let token = 'old';
  let refreshed = 0;
  setHostAuth({ base: '', token: () => token, refresh: async () => { refreshed += 1; token = 'new'; return token; } });
  const seen: string[] = [];
  globalThis.fetch = (async (_: string, init: RequestInit) => {
    const auth = (init.headers as Record<string, string>).Authorization;
    seen.push(auth);
    return auth === 'Bearer new' ? new Response('{"ok":1}', { status: 200 }) : new Response('{}', { status: 401 });
  }) as typeof fetch;
  assert.deepEqual(await api({}, '/v1/planograms'), { ok: 1 });
  assert.deepEqual(seen, ['Bearer old', 'Bearer new']);
  assert.equal(refreshed, 1);
});

test('токен обновить не удалось — понятная ошибка, а не про ключ', async () => {
  setHostAuth({ base: '', token: () => 'old', refresh: async () => null });
  globalThis.fetch = (async () => new Response('{}', { status: 401 })) as unknown as typeof fetch;
  await assert.rejects(api({}, '/v1/planograms'), (e: ApiError) => e.status === 401 && e.message.includes('войдите в кабинет'));
});

test('сверка в кабинете идёт в /v1/studio/check и не опрашивает статус', async () => {
  setHostAuth({ base: '/api', token: () => 't1', refresh: async () => null });
  const urls: string[] = [];
  globalThis.fetch = (async (url: string) => {
    urls.push(url);
    return new Response(JSON.stringify({ status: 'done', photo_id: 'p1', result: { fill: {} } }), { status: 200 });
  }) as typeof fetch;
  const file = new File([new Uint8Array([1])], 'a.jpg');
  const got = await analyzePhoto({}, file, { planogram: 'x' }, () => {});
  assert.deepEqual(urls, ['/api/v1/studio/check']);
  assert.equal(got.photoId, 'p1');
});

test('сама по себе Studio работает как раньше: ключ и клиент', async () => {
  setConnection({ key: 'k1', client: 'pmi', name: '' });
  assert.deepEqual(authHeaders(), { 'X-API-Key': 'k1', 'X-Client-Id': 'pmi' });
});
