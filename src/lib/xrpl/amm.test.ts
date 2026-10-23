import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BigNumber, XRP, assetId, currencyLabel, normalizeCurrency, parseAssetId, toAmount } from './assets'
import { type Pool, lpForTwoAssetDeposit, swapIn, swapOut, withdrawForLp } from './amm'
import { simulateRoute } from './quote'
import { buildSwap } from './tx'

const TOKEN = { currency: normalizeCurrency('MEME'), issuer: 'rIssuerXXXXXXXXXXXXXXXXXXXXXXXXX' }
const USD = { currency: 'USD', issuer: 'rUsdIssuerXXXXXXXXXXXXXXXXXXXXXX' }

const pool = (a1: any, r1: number, a2: any, r2: number, fee = 300): Pool => ({
  account: 'rAMM',
  asset1: a1,
  asset2: a2,
  reserve1: new BigNumber(r1),
  reserve2: new BigNumber(r2),
  tradingFee: fee,
  lpToken: { currency: '03' + '0'.repeat(38), issuer: 'rAMM', supply: new BigNumber(Math.sqrt(r1 * r2)) },
})

test('currency codes round-trip', () => {
  assert.equal(normalizeCurrency('USD'), 'USD')
  assert.equal(normalizeCurrency('MEME').length, 40)
  assert.equal(currencyLabel(normalizeCurrency('MEME')), 'MEME')
  assert.equal(currencyLabel(normalizeCurrency('SoloGenic')), 'SoloGenic')
  const id = assetId(TOKEN)
  assert.deepEqual(parseAssetId(id), TOKEN)
  assert.deepEqual(parseAssetId('xrp'), XRP)
})

test('toAmount: XRP drops and IOU precision', () => {
  assert.equal(toAmount(XRP, '1.2345678'), '1234567')
  assert.equal(toAmount(XRP, '1.2345671', 'up'), '1234568')
  const iou = toAmount(USD, '1.23456789012345678') as any
  assert.equal(iou.value, '1.23456789012345')
})

test('swapOut matches constant product with input fee', () => {
  const p = pool(XRP, 10_000, TOKEN, 1_000_000, 1000) // 1% fee
  const out = swapOut(p, XRP, 100)
  // 1_000_000 * 99 / (10_000 + 99)
  assert.ok(out.minus(new BigNumber(1_000_000).times(99).div(10_099)).abs().lt(1e-9))
  // never drains the pool
  assert.ok(swapOut(p, XRP, 1e12).lt(1_000_000))
})

test('swapIn is the inverse of swapOut', () => {
  const p = pool(XRP, 50_000, TOKEN, 7_000_000, 500)
  const out = swapOut(p, XRP, 1234)
  const back = swapIn(p, XRP, out)
  assert.ok(back.minus(1234).abs().lt(1e-6), back.toString())
})

test('quote: price impact, minOut and 2-hop route via XRP', () => {
  const p1 = pool(TOKEN, 1_000_000, XRP, 10_000, 300)
  const p2 = pool(XRP, 20_000, USD, 10_000, 300)
  const q = simulateRoute([p1, p2], TOKEN, USD, new BigNumber(10_000), 1)!
  assert.ok(q)
  assert.ok(q.amountOut.gt(0))
  assert.ok(q.minOut.lt(q.amountOut))
  assert.ok(q.minOut.minus(q.amountOut.times(0.99)).abs().lt(1e-9))
  // spot = 0.01 XRP/token * 0.5 USD/XRP = 0.005 USD/token → ~50 USD before impact & fees
  assert.ok(q.amountOut.lt(50) && q.amountOut.gt(45), q.amountOut.toString())
  assert.ok(q.priceImpact.gt(0) && q.priceImpact.lt(0.05))
  assert.equal(q.feePercent, 0.6)
})

test('LP math: deposit/withdraw are proportional', () => {
  const p = pool(XRP, 10_000, TOKEN, 1_000_000)
  const lp = lpForTwoAssetDeposit(p, 100, 10_000) // 1% of each side
  assert.ok(lp.div(p.lpToken.supply).minus(0.01).abs().lt(1e-12))
  const w = withdrawForLp(p, p.lpToken.supply.times(0.1))
  assert.ok(w.amt1.minus(1000).abs().lt(1e-9))
  assert.ok(w.amt2.minus(100_000).abs().lt(1e-6))
})

test('buildSwap: OfferCreate sell + fill-or-kill', () => {
  const tx = buildSwap('rUser', XRP, TOKEN, new BigNumber(10), new BigNumber('98765.4321'))
  assert.equal(tx.TransactionType, 'OfferCreate')
  assert.equal(tx.TakerGets, '10000000')
  assert.deepEqual(tx.TakerPays, { ...TOKEN, value: '98765.4321' })
  assert.equal(tx.Flags, 0x00080000 | 0x00040000)
})
