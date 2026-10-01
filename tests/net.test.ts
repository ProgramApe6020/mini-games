/**
 * 联机传输层里纯逻辑部分的测试（房间码、座位排序等）。
 * 运行方式：npm test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  randomRoomCode,
  seatLabel,
  sortPeers,
  type PeerInfo,
} from '../src/lib/net/types.ts';

test('房间码：长度正确、只用不易混淆的字符', () => {
  for (let i = 0; i < 200; i += 1) {
    const code = randomRoomCode();
    assert.equal(code.length, 4);
    assert.match(code, /^[A-Z2-9]+$/);
    // 0/O、1/I/L 都容易看错，不应该出现在房间码里
    assert.doesNotMatch(code, /[01OIL]/);
  }

  assert.equal(randomRoomCode(6).length, 6);
});

test('房间码：多次生成不会永远一样', () => {
  const codes = new Set<string>();
  for (let i = 0; i < 50; i += 1) codes.add(randomRoomCode(6));
  assert.ok(codes.size > 40, `50 次生成只出现 ${codes.size} 个不同房间码，随机性太差`);
});

test('成员排序：按座位排，同一座位再按 id 排，且不修改原数组', () => {
  const peers: PeerInfo[] = [
    { id: 'zoe', seat: 1, name: '玩家 2' },
    { id: 'bob', seat: 0, name: '玩家 1' },
    { id: 'amy', seat: 0, name: '玩家 1' },
  ];
  const snapshot = [...peers];

  const sorted = sortPeers(peers);

  assert.deepEqual(
    sorted.map((peer) => peer.id),
    ['amy', 'bob', 'zoe'],
  );
  assert.deepEqual(peers, snapshot, '原数组不应该被排序修改');
});

test('座位名称：0 是玩家 1，1 是玩家 2', () => {
  assert.equal(seatLabel(0), '玩家 1');
  assert.equal(seatLabel(1), '玩家 2');
});
