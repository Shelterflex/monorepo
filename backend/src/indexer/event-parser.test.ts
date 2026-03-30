import { describe, it, expect } from 'vitest'
import { parseReceiptEvent, tryParseReceiptEvent, parseTimelockEvent, RawReceiptEvent } from './event-parser.js'

// ── Valid baseline event ─────────────────────────────────────────────────────

function validRaw(overrides?: Partial<RawReceiptEvent['data']>): RawReceiptEvent {
  return {
    ledger: 1000,
    txHash: 'abc123',
    contractId: 'CAAAA',
    data: {
      tx_id: 'tx_001',
      tx_type: 'TENANT_REPAYMENT',
      deal_id: 'deal_001',
      amount_usdc: '500',
      external_ref: 'ref_001',
      ...overrides,
    },
  }
}

// ── Happy path ───────────────────────────────────────────────────────────────

describe('parseReceiptEvent', () => {
  it('parses a valid event with all required fields', () => {
    const result = parseReceiptEvent(validRaw())
    expect(result.txId).toBe('tx_001')
    expect(result.txType).toBe('TENANT_REPAYMENT')
    expect(result.dealId).toBe('deal_001')
    expect(result.amountUsdc).toBe('500')
    expect(result.externalRefHash).toBe('ref_001')
    expect(result.ledger).toBe(1000)
    expect(result.indexedAt).toBeInstanceOf(Date)
  })

  it('parses optional fields when present', () => {
    const result = parseReceiptEvent(validRaw({
      listing_id: 'list_001',
      amount_ngn: 750000,
      fx_rate: 1500,
      fx_provider: 'paystack',
      from: 'GAAAA',
      to: 'GBBBB',
      metadata_hash: 'hash123',
    }))
    expect(result.listingId).toBe('list_001')
    expect(result.amountNgn).toBe(750000)
    expect(result.fxRate).toBe(1500)
    expect(result.fxProvider).toBe('paystack')
    expect(result.from).toBe('GAAAA')
    expect(result.to).toBe('GBBBB')
    expect(result.metadataHash).toBe('hash123')
  })

  it('returns undefined for missing optional fields', () => {
    const result = parseReceiptEvent(validRaw())
    expect(result.listingId).toBeUndefined()
    expect(result.amountNgn).toBeUndefined()
    expect(result.fxRate).toBeUndefined()
    expect(result.fxProvider).toBeUndefined()
    expect(result.from).toBeUndefined()
    expect(result.to).toBeUndefined()
    expect(result.metadataHash).toBeUndefined()
  })
})

// ── Edge cases: missing/empty required fields ────────────────────────────────

describe('parseReceiptEvent – missing required fields', () => {
  it('throws on missing tx_id', () => {
    const raw = validRaw()
    delete raw.data.tx_id
    expect(() => parseReceiptEvent(raw)).toThrow("Missing 'tx_id'")
  })

  it('throws on missing tx_type', () => {
    const raw = validRaw()
    delete raw.data.tx_type
    expect(() => parseReceiptEvent(raw)).toThrow("Missing 'tx_type'")
  })

  it('throws on missing deal_id', () => {
    const raw = validRaw()
    delete raw.data.deal_id
    expect(() => parseReceiptEvent(raw)).toThrow("Missing 'deal_id'")
  })

  it('throws on missing amount_usdc', () => {
    const raw = validRaw()
    delete raw.data.amount_usdc
    expect(() => parseReceiptEvent(raw)).toThrow("Missing 'amount_usdc'")
  })

  it('throws on missing external_ref', () => {
    const raw = validRaw()
    delete raw.data.external_ref
    expect(() => parseReceiptEvent(raw)).toThrow("Missing 'external_ref'")
  })

  it('throws on empty string tx_id', () => {
    expect(() => parseReceiptEvent(validRaw({ tx_id: '' }))).toThrow("Missing 'tx_id'")
  })

  it('throws on empty string deal_id', () => {
    expect(() => parseReceiptEvent(validRaw({ deal_id: '' }))).toThrow("Missing 'deal_id'")
  })
})

// ── Edge cases: malformed values ─────────────────────────────────────────────

describe('parseReceiptEvent – malformed values', () => {
  it('throws when required field is a number instead of string', () => {
    expect(() => parseReceiptEvent(validRaw({ tx_id: 12345 as unknown as string }))).toThrow("Missing 'tx_id'")
  })

  it('throws when required field is a boolean', () => {
    expect(() => parseReceiptEvent(validRaw({ deal_id: true as unknown as string }))).toThrow("Missing 'deal_id'")
  })

  it('throws when required field is null', () => {
    expect(() => parseReceiptEvent(validRaw({ tx_type: null as unknown as string }))).toThrow("Missing 'tx_type'")
  })

  it('ignores non-string optional fields gracefully', () => {
    const result = parseReceiptEvent(validRaw({
      listing_id: 12345 as unknown as string,
      fx_provider: false as unknown as string,
    }))
    expect(result.listingId).toBeUndefined()
    expect(result.fxProvider).toBeUndefined()
  })

  it('ignores non-number optional numeric fields', () => {
    const result = parseReceiptEvent(validRaw({
      amount_ngn: 'not_a_number' as unknown as number,
      fx_rate: true as unknown as number,
    }))
    expect(result.amountNgn).toBeUndefined()
    expect(result.fxRate).toBeUndefined()
  })
})

// ── Edge cases: extra fields are safely ignored ──────────────────────────────

describe('parseReceiptEvent – extra fields', () => {
  it('ignores unexpected extra fields in data', () => {
    const result = parseReceiptEvent(validRaw({
      unexpected_field: 'surprise',
      another_extra: 42,
      nested_object: { deep: true },
    } as Record<string, unknown>))
    expect(result.txId).toBe('tx_001')
    // Extra fields should not appear in the result
    expect((result as Record<string, unknown>)['unexpected_field']).toBeUndefined()
  })
})

// ── tryParseReceiptEvent (safe wrapper) ──────────────────────────────────────

describe('tryParseReceiptEvent', () => {
  it('returns parsed receipt for valid events', () => {
    const result = tryParseReceiptEvent(validRaw())
    expect(result).not.toBeNull()
    expect(result!.txId).toBe('tx_001')
  })

  it('returns null for missing required fields', () => {
    const raw = validRaw()
    delete raw.data.tx_id
    expect(tryParseReceiptEvent(raw)).toBeNull()
  })

  it('returns null for empty data object', () => {
    expect(tryParseReceiptEvent({
      ledger: 1000,
      txHash: 'abc',
      contractId: 'C',
      data: {},
    })).toBeNull()
  })

  it('returns null when data is not an object', () => {
    expect(tryParseReceiptEvent({
      ledger: 1000,
      txHash: 'abc',
      contractId: 'C',
      data: 'not_an_object' as unknown as Record<string, unknown>,
    })).toBeNull()
  })

  it('returns null when ledger is not a number', () => {
    expect(tryParseReceiptEvent({
      ledger: 'not_a_number' as unknown as number,
      txHash: 'abc',
      contractId: 'C',
      data: { tx_id: 'tx', tx_type: 'T', deal_id: 'd', amount_usdc: '1', external_ref: 'r' },
    })).toBeNull()
  })

  it('returns null for null input', () => {
    expect(tryParseReceiptEvent(null as unknown as RawReceiptEvent)).toBeNull()
  })

  it('returns null for undefined input', () => {
    expect(tryParseReceiptEvent(undefined as unknown as RawReceiptEvent)).toBeNull()
  })

  it('safely ignores extra fields', () => {
    const result = tryParseReceiptEvent(validRaw({
      bonus_field: 'extra',
    } as Record<string, unknown>))
    expect(result).not.toBeNull()
    expect(result!.txId).toBe('tx_001')
  })
})

// ── Timelock Events ──────────────────────────────────────────────────────────

describe('parseTimelockEvent', () => {
    it('parses a queued event correctly', () => {
        const raw = {
            ledger: 2000,
            topic: ['governance', 'queued'],
            data: [
                'hash_123',
                'StakingContract',
                'pause',
                ['arg1'],
                1700000000
            ]
        };
        const result = parseTimelockEvent(raw);
        expect(result).not.toBeNull();
        expect(result!.type).toBe('queued');
        expect(result!.txHash).toBe('hash_123');
        expect(result!.target).toBe('StakingContract');
        expect(result!.functionName).toBe('pause');
        expect(result!.args).toEqual(['arg1']);
        expect(result!.delay).toBe(1700000000);
        expect(result!.ledger).toBe(2000);
    });

    it('parses an executed event correctly', () => {
        const raw = {
            ledger: 2005,
            topic: ['governance', 'executed'],
            data: 'hash_123'
        };
        const result = parseTimelockEvent(raw);
        expect(result).not.toBeNull();
        expect(result!.type).toBe('executed');
        expect(result!.txHash).toBe('hash_123');
        expect(result!.ledger).toBe(2005);
    });

    it('parses a cancelled event correctly', () => {
        const raw = {
            ledger: 2010,
            topic: ['governance', 'cancelled'],
            data: 'hash_123'
        };
        const result = parseTimelockEvent(raw);
        expect(result).not.toBeNull();
        expect(result!.type).toBe('cancelled');
        expect(result!.txHash).toBe('hash_123');
        expect(result!.ledger).toBe(2010);
    });

    it('returns null for non-governance events', () => {
        const raw = {
            topic: ['other_topic', 'some_event'],
            data: []
        };
        expect(parseTimelockEvent(raw)).toBeNull();
    });

    it('handles malformed data gracefully', () => {
        const raw = {
            topic: ['governance', 'queued'],
            data: 'not_an_array'
        };
        expect(parseTimelockEvent(raw)).toBeNull();
    });
});
