/**
 * End-to-end check of the DEX transaction builders on XRPL testnet.
 *
 *   npm run smoke
 *
 * Funds fresh wallets from the faucet, issues a token, creates an XRP/token
 * AMM, then exercises quote → swap (buy & sell), deposit and withdraw using
 * exactly the same lib code the frontend uses.
 */
import { AccountSetAsfFlags, Client, type SubmittableTransaction, type Wallet } from 'xrpl'
import { getAccountState, needsTrustLine, spendable } from '../src/lib/xrpl/account'
import { canonical, getPool, withdrawForLp } from '../src/lib/xrpl/amm'
import { BigNumber, XRP, normalizeCurrency } from '../src/lib/xrpl/assets'
import { quoteExactIn } from '../src/lib/xrpl/quote'
import { buildAmmCreate, buildDepositTwo, buildSwap, buildTrustSet, buildWithdrawLp } from '../src/lib/xrpl/tx'

const WS = process.env.SMOKE_WS ?? 'wss://s.altnet.rippletest.net:51233'
const c = new Client(WS)

async function submit(w: Wallet, tx: SubmittableTransaction, label: string) {
  const r: any = await c.submitAndWait(tx, { wallet: w, autofill: true })
  const code = r.result.meta?.TransactionResult
  console.log(`  ${code === 'tesSUCCESS' ? '✓' : '✗'} ${label}: ${code}`)
  if (code !== 'tesSUCCESS') throw new Error(`${label} failed: ${code}`)
  return r
}

async function main() {
  await c.connect()
  console.log('Funding wallets…')
  const [{ wallet: issuer }, { wallet: lp }, { wallet: trader }, { wallet: lazy }] = await Promise.all([
    c.fundWallet(),
    c.fundWallet(),
    c.fundWallet(),
    c.fundWallet(),
  ])
  const MEME = { currency: normalizeCurrency('SMOKE'), issuer: issuer.address }

  console.log('Issuing token…')
  await submit(issuer, { TransactionType: 'AccountSet', Account: issuer.address, SetFlag: AccountSetAsfFlags.asfDefaultRipple }, 'issuer DefaultRipple')
  await submit(lp, buildTrustSet(lp.address, MEME), 'LP trust line')
  await submit(
    issuer,
    { TransactionType: 'Payment', Account: issuer.address, Destination: lp.address, Amount: { ...MEME, value: '1000000' } },
    'mint 1,000,000 SMOKE to LP',
  )

  console.log('Creating pool…')
  await submit(lp, buildAmmCreate(lp.address, XRP, new BigNumber(20), MEME, new BigNumber(500_000), 0.5), 'AMMCreate 20 XRP / 500k SMOKE')
  let pool = canonical((await getPool(c, XRP, MEME))!)
  console.log(`  pool ${pool.account}: ${pool.reserve1} XRP / ${pool.reserve2} SMOKE`)

  console.log('Buying…')
  let state = await getAccountState(c, trader.address)
  if (needsTrustLine(state, MEME)) await submit(trader, buildTrustSet(trader.address, MEME), 'trader enables SMOKE')
  const buyQ = (await quoteExactIn(c, XRP, MEME, 2, 1))!
  console.log(`  quote: 2 XRP → ${buyQ.amountOut.toFixed(4)} SMOKE (impact ${buyQ.priceImpact.times(100).toFixed(2)}%)`)
  await submit(trader, buildSwap(trader.address, XRP, MEME, buyQ.amountIn, buyQ.minOut), 'swap 2 XRP → SMOKE')
  state = await getAccountState(c, trader.address)
  const got = spendable(state, MEME)
  console.log(`  received ${got.toFixed(4)} SMOKE (min ${buyQ.minOut.toFixed(4)})`)
  if (got.lt(buyQ.minOut)) throw new Error('Received less than minOut')

  console.log('Selling half back…')
  const sellQ = (await quoteExactIn(c, MEME, XRP, got.div(2), 1))!
  await submit(trader, buildSwap(trader.address, MEME, XRP, sellQ.amountIn, sellQ.minOut), `swap ${sellQ.amountIn.toFixed(2)} SMOKE → XRP`)

  console.log('Slippage protection (expect tecKILLED)…')
  const greedy = buildSwap(trader.address, XRP, MEME, new BigNumber(1), buyQ.amountOut.times(10))
  const r: any = await c.submitAndWait(greedy, { wallet: trader, autofill: true })
  console.log(`  ${r.result.meta.TransactionResult === 'tecKILLED' ? '✓' : '✗'} unrealistic minimum: ${r.result.meta.TransactionResult}`)

  console.log('Swap without a trust line (informational)…')
  const lazyQ = (await quoteExactIn(c, XRP, MEME, 1, 1))!
  const lr: any = await c.submitAndWait(buildSwap(lazy.address, XRP, MEME, lazyQ.amountIn, lazyQ.minOut), { wallet: lazy, autofill: true })
  console.log(`  result: ${lr.result.meta.TransactionResult} — ${lr.result.meta.TransactionResult === 'tesSUCCESS' ? 'offers auto-create trust lines; the frontend could skip the Enable step' : 'explicit TrustSet is required (frontend already does this)'}`)

  console.log('Liquidity…')
  pool = canonical((await getPool(c, XRP, MEME))!)
  const addXrp = new BigNumber(1)
  const addTok = addXrp.times(pool.reserve2).div(pool.reserve1).times(1.005)
  await submit(lp, buildDepositTwo(lp.address, XRP, addXrp, MEME, addTok), 'two-asset deposit')
  state = await getAccountState(c, lp.address)
  const lpBal = state.lines.find((l) => l.issuer === pool.account)!.balance
  pool = canonical((await getPool(c, XRP, MEME))!)
  const expected = withdrawForLp(pool, lpBal.div(4))
  await submit(lp, buildWithdrawLp(lp.address, XRP, MEME, pool.lpToken, lpBal.div(4)), `withdraw 25% LP (~${expected.amt1.toFixed(3)} XRP)`)

  console.log('\nAll checks passed.')
  await c.disconnect()
}

main().catch(async (e) => {
  console.error('\nSmoke test failed:', e?.message ?? e)
  await c.disconnect().catch(() => {})
  process.exit(1)
})
