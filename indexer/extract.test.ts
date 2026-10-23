import { test } from 'node:test'
import assert from 'node:assert/strict'
import { type KnownPool, extract } from './extract'

const AMM = 'rAMMaccountXXXXXXXXXXXXXXXXXXXXXX'
const ISSUER = 'rIssuerXXXXXXXXXXXXXXXXXXXXXXXXX'
const USER = 'rUserXXXXXXXXXXXXXXXXXXXXXXXXXXX'
const CUR = '4D454D4500000000000000000000000000000000'
const TOKEN = `${CUR}.${ISSUER}`

const pools = new Map<string, KnownPool>([[AMM, { account: AMM, asset1: 'XRP', asset2: TOKEN }]])

/** A user buys tokens: pool gains 100 XRP, loses 9,000 tokens. AMM is the HIGH side of the line. */
const buyMeta = {
  TransactionResult: 'tesSUCCESS',
  AffectedNodes: [
    {
      ModifiedNode: {
        LedgerEntryType: 'AccountRoot',
        FinalFields: { Account: AMM, Balance: '10100000000' },
        PreviousFields: { Balance: '10000000000' },
      },
    },
    {
      ModifiedNode: {
        LedgerEntryType: 'RippleState',
        FinalFields: {
          Balance: { currency: CUR, issuer: 'rrrrrrrrrrrrrrrrrrrrBZbvji', value: '-991000' },
          HighLimit: { currency: CUR, issuer: AMM, value: '0' },
          LowLimit: { currency: CUR, issuer: ISSUER, value: '0' },
        },
        PreviousFields: { Balance: { currency: CUR, issuer: 'rrrrrrrrrrrrrrrrrrrrBZbvji', value: '-1000000' } },
      },
    },
    {
      ModifiedNode: {
        LedgerEntryType: 'AccountRoot',
        FinalFields: { Account: USER, Balance: '1' },
        PreviousFields: { Balance: '100000012' },
      },
    },
  ],
}

test('swap: deltas and final reserves from metadata (AMM on high side)', () => {
  const ex = extract({ TransactionType: 'OfferCreate', Account: USER }, buyMeta, pools)
  assert.equal(ex.events.length, 1)
  const e = ex.events[0]
  assert.equal(e.kind, 'swap')
  assert.equal(e.account, USER)
  assert.equal(e.delta1.toFixed(), '100')
  assert.equal(e.delta2.toFixed(), '-9000')
  assert.equal(e.final1!.toFixed(), '10100')
  assert.equal(e.final2!.toFixed(), '991000')
})

test('failed transactions are ignored', () => {
  const ex = extract({ TransactionType: 'OfferCreate' }, { ...buyMeta, TransactionResult: 'tecKILLED' }, pools)
  assert.equal(ex.events.length, 0)
})

test('AMMCreate registers a canonical pool and an initial deposit', () => {
  const NEW = 'rNewAMMXXXXXXXXXXXXXXXXXXXXXXXXXX'
  const meta = {
    TransactionResult: 'tesSUCCESS',
    AffectedNodes: [
      {
        CreatedNode: {
          LedgerEntryType: 'AMM',
          NewFields: {
            Account: NEW,
            Asset: { currency: CUR, issuer: ISSUER },
            Asset2: { currency: 'XRP' },
            TradingFee: 500,
            LPTokenBalance: { currency: '03ABC', issuer: NEW, value: '1000' },
          },
        },
      },
      { CreatedNode: { LedgerEntryType: 'AccountRoot', NewFields: { Account: NEW, Balance: '50000000' } } },
      {
        CreatedNode: {
          LedgerEntryType: 'RippleState',
          NewFields: {
            Balance: { currency: CUR, issuer: 'rrrrrrrrrrrrrrrrrrrrBZbvji', value: '20000' },
            HighLimit: { currency: CUR, issuer: ISSUER, value: '0' },
            LowLimit: { currency: CUR, issuer: NEW, value: '0' },
          },
        },
      },
    ],
  }
  const ex = extract({ TransactionType: 'AMMCreate', Account: USER }, meta, new Map(pools))
  assert.equal(ex.created.length, 1)
  assert.equal(ex.created[0].asset1, 'XRP') // flipped to canonical
  assert.equal(ex.created[0].asset2, TOKEN)
  assert.equal(ex.events.length, 1)
  assert.equal(ex.events[0].kind, 'deposit')
  assert.equal(ex.events[0].final1!.toFixed(), '50')
  assert.equal(ex.events[0].final2!.toFixed(), '20000') // AMM is LOW side → positive
  assert.equal(ex.events[0].tradingFee, 500)
})

test('unknown AMM touched without asset info is reported for resync', () => {
  const meta = {
    TransactionResult: 'tesSUCCESS',
    AffectedNodes: [
      { ModifiedNode: { LedgerEntryType: 'AMM', FinalFields: { Account: 'rOtherAMM', LPTokenBalance: { value: '5' } } } },
    ],
  }
  const ex = extract({ TransactionType: 'AMMDeposit' }, meta, pools)
  assert.deepEqual(ex.unknown, ['rOtherAMM'])
})
