import test from 'node:test'
import assert from 'node:assert/strict'
import { gameParticipants } from '../src/data/game-participants.js'
test('owner identity follows account ownership, independent of seat position and bots', () => {
  const seats = [{ accountId: 'a', name: 'Alice', kind: 'human' }, {
    accountId: 'b',
    name: 'Bob',
    kind: 'human',
    seatIndex: 5,
  }, {
    accountId: 'b',
    name: '规则电脑',
    kind: 'bot',
  }]
  assert.deepEqual(gameParticipants({ creatorAccountId: 'b', seats }).map(p => p.isOwner), [false, true, false])
  assert.deepEqual(gameParticipants({ creatorAccountId: 'a', seats }).map(p => p.isOwner), [true, false, false])
  assert.equal(gameParticipants({ creatorAccountId: 'b', seats })[1]?.seatIndex, 5)
  assert.equal(gameParticipants({ creatorAccountId: 'b', seats })[1]?.name, 'Bob')
  assert(!JSON.stringify(gameParticipants({ creatorAccountId: 'b', seats })).includes('accountId'))
})
test('only bounded inline bitmap avatars enter the isolated public projection', () => {
  for (
    const avatar of [
      'https://example.com/avatar.png',
      'data:image/svg+xml;base64,AAAA',
      'file:///avatar.png',
      'data:image/png;base64,AA',
      'data:image/png;base64,AAAA\n',
      'data:image/png;base64,' + 'A'.repeat(65536),
    ]
  ) {
    assert.equal(gameParticipants({ seats: [{ avatar }] })[0]?.avatar, undefined)
  }
  assert.equal(
    gameParticipants({ seats: [{ avatar: 'data:image/png;base64,AAAA' }] })[0]?.avatar,
    'data:image/png;base64,AAAA',
  )
})

test('public seat avatars remain distinct and in seat order; missing avatars are never borrowed from the owner', () => {
  const ownerAvatar = 'data:image/png;base64,AAAA'
  const friendAvatar = 'data:image/png;base64,BBBB'
  const participants = gameParticipants({
    creatorAccountId: 'owner',
    seats: [
      { accountId: 'friend', name: 'Friend', kind: 'human', avatar: friendAvatar },
      { accountId: 'owner', name: 'Owner', kind: 'human', avatar: ownerAvatar },
      { accountId: 'no-avatar', name: 'Another player', kind: 'human' },
      { name: 'Rules bot', kind: 'bot' },
    ],
  })
  assert.deepEqual(participants.map(p => [p.seatIndex, p.name, p.avatar, p.isOwner]), [
    [0, 'Friend', friendAvatar, false],
    [1, 'Owner', ownerAvatar, true],
    [2, 'Another player', undefined, false],
    [3, 'Rules bot', undefined, false],
  ])
})
