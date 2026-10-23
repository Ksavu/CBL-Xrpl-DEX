import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.NEXT_PUBLIC_FEE_ACCOUNT = 'rrrrrrrrrrrrrrrrrrrrBZbvji'
process.env.NEXT_PUBLIC_FEE_BPS = '50'

test('fee: XRP in, token in, batch shape', async () => {
  const { BigNumber, XRP, normalizeCurrency } = await import('./assets')
  const { feeForSwap, netSwapIn, buildSwapWithFeeBatch } = await import('./fee')
  const { simulateRoute } = await import('./quote')
  const { buildSwap } = await import('./tx')
  const TOKEN = { currency: normalizeCurrency('MEME'), issuer: 'rIssuerXXXXXXXXXXXXXXXXXXXXXXXXX' }
  const pool = {
    account: 'rAMM', asset1: XRP, asset2: TOKEN, reserve1: new BigNumber(10_000), reserve2: new BigNumber(1_000_000),
    tradingFee: 300, lpToken: { currency: '03', issuer: 'rAMM', supply: new BigNumber(100_000) },
  } as any

  // XRP → token: 0.5% of input, deducted before the swap
  const f1 = feeForSwap(XRP, TOKEN, new BigNumber(100), null)
  assert.equal(f1.toFixed(), '0.5')
  assert.equal(netSwapIn(XRP, new BigNumber(100), f1).toFixed(), '99.5')

  // token → XRP: 0.5% of guaranteed minimum XRP out
  const q = simulateRoute([pool], TOKEN, XRP, new BigNumber(10_000), 1)!
  const f2 = feeForSwap(TOKEN, XRP, new BigNumber(10_000), q)
  assert.equal(f2.toFixed(), q.minOut.times(0.005).decimalPlaces(6, BigNumber.ROUND_DOWN).toFixed())

  // dust is skipped
  assert.equal(feeForSwap(XRP, TOKEN, new BigNumber('0.001'), null).toFixed(), '0')

  const swap = buildSwap('rUser', XRP, TOKEN, new BigNumber('99.5'), new BigNumber(9000))
  const b: any = buildSwapWithFeeBatch('rUser', swap, f1)
  assert.equal(b.TransactionType, 'Batch')
  assert.equal(b.Flags, 0x00010000) // tfAllOrNothing
  assert.equal(b.RawTransactions.length, 2)
  const [s, p] = b.RawTransactions.map((r: any) => r.RawTransaction)
  assert.equal(s.TransactionType, 'OfferCreate')
  assert.ok(s.Flags & 0x40000000) // tfInnerBatchTxn
  assert.equal(s.Fee, '0')
  assert.equal(p.TransactionType, 'Payment')
  assert.equal(p.Destination, 'rrrrrrrrrrrrrrrrrrrrBZbvji')
  assert.equal(p.Amount, '500000')
})
