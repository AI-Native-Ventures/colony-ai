//! Server-owned credit pack prices and grants.

use serde::Serialize;

const NANO_USD_PER_CENT: i64 = 10_000_000;

/// A server-priced top-up. Clients select the identifier and never submit a price.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreditPack {
    /// Stable identifier accepted by checkout.
    pub id: &'static str,
    /// Name shown by the desktop client.
    pub name: &'static str,
    /// Amount charged by PayFast, in ZAR cents.
    pub zar_cents: i64,
    /// USD cents charged by Stripe.
    pub usd_cents: i64,
    /// Credits added after a verified payment, in ledger nanoUSD.
    pub grant_nanousd: i64,
}

impl CreditPack {
    /// Amount charged in the provider's currency minor units.
    pub fn price_in(&self, currency: Currency) -> i64 {
        match currency {
            Currency::Zar => self.zar_cents,
            Currency::Usd => self.usd_cents,
        }
    }
}

/// Currency charged by the configured provider.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum Currency {
    /// South African Rand.
    Zar,
    /// US dollars.
    Usd,
}

impl Currency {
    /// ISO 4217 currency code.
    pub fn code(self) -> &'static str {
        match self {
            Currency::Zar => "ZAR",
            Currency::Usd => "USD",
        }
    }
}

/// Packs ordered from the smallest to largest purchase.
pub const CREDIT_PACKS: &[CreditPack] = &[
    CreditPack {
        id: "starter",
        name: "Starter",
        usd_cents: 0,
        zar_cents: 11_900,
        grant_nanousd: 500 * NANO_USD_PER_CENT,
    },
    CreditPack {
        id: "growth",
        name: "Growth",
        usd_cents: 0,
        zar_cents: 29_900,
        grant_nanousd: 1_400 * NANO_USD_PER_CENT,
    },
    CreditPack {
        id: "scale",
        name: "Scale",
        usd_cents: 0,
        zar_cents: 89_900,
        grant_nanousd: 4_400 * NANO_USD_PER_CENT,
    },
    CreditPack {
        id: "pro",
        name: "Pro",
        usd_cents: 0,
        zar_cents: 244_900,
        grant_nanousd: 12_000 * NANO_USD_PER_CENT,
    },
    CreditPack {
        id: "studio",
        name: "Studio",
        usd_cents: 0,
        zar_cents: 508_900,
        grant_nanousd: 25_000 * NANO_USD_PER_CENT,
    },
    CreditPack {
        id: "agency",
        name: "Agency",
        usd_cents: 0,
        zar_cents: 1_014_900,
        grant_nanousd: 50_000 * NANO_USD_PER_CENT,
    },
    CreditPack {
        id: "enterprise",
        name: "Enterprise",
        usd_cents: 0,
        zar_cents: 2_024_900,
        grant_nanousd: 100_000 * NANO_USD_PER_CENT,
    },
];

/// Dollar packs grant their full purchase value; markup is charged on usage.
pub const USD_CREDIT_PACKS: &[CreditPack] = &[
    CreditPack {
        id: "usd-5",
        name: "Starter",
        zar_cents: 0,
        usd_cents: 500,
        grant_nanousd: 5_000_000_000,
    },
    CreditPack {
        id: "usd-15",
        name: "Growth",
        zar_cents: 0,
        usd_cents: 1500,
        grant_nanousd: 15_000_000_000,
    },
    CreditPack {
        id: "usd-50",
        name: "Scale",
        zar_cents: 0,
        usd_cents: 5000,
        grant_nanousd: 50_000_000_000,
    },
    CreditPack {
        id: "usd-120",
        name: "Pro",
        zar_cents: 0,
        usd_cents: 12000,
        grant_nanousd: 120_000_000_000,
    },
];

/// Packs for the selected charge currency.
pub fn packs_for(currency: Currency) -> &'static [CreditPack] {
    match currency {
        Currency::Zar => CREDIT_PACKS,
        Currency::Usd => USD_CREDIT_PACKS,
    }
}

/// Reject identifiers from another provider's catalog as well as unknown packs.
pub fn find_pack_in(id: &str, currency: Currency) -> Option<&'static CreditPack> {
    packs_for(currency).iter().find(|pack| pack.id == id)
}

/// Find a pack by its stable checkout identifier.
pub fn find_pack(id: &str) -> Option<&'static CreditPack> {
    CREDIT_PACKS.iter().find(|pack| pack.id == id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stripe_catalog_rejects_unknown_and_payfast_packs_and_grants_exact_dollars() {
        assert!(find_pack_in("made-up", Currency::Usd).is_none());
        assert!(find_pack_in("starter", Currency::Usd).is_none());
        assert!(find_pack_in("usd-5", Currency::Zar).is_none());
        assert_eq!(
            USD_CREDIT_PACKS
                .iter()
                .map(|p| p.usd_cents)
                .collect::<Vec<_>>(),
            vec![500, 1500, 5000, 12000]
        );
        for pack in USD_CREDIT_PACKS {
            assert_eq!(
                pack.grant_nanousd,
                pack.price_in(Currency::Usd) * NANO_USD_PER_CENT
            );
        }
    }

    #[test]
    fn pack_ids_are_unique_and_all_amounts_are_positive() {
        let mut ids = std::collections::HashSet::new();
        for pack in CREDIT_PACKS {
            assert!(ids.insert(pack.id));
            assert!(pack.zar_cents > 0);
            assert!(pack.grant_nanousd > 0);
        }
    }

    #[test]
    fn checkout_price_is_a_server_owned_zar_amount() {
        let pack = find_pack("growth").expect("known pack");
        assert_eq!(pack.price_in(Currency::Zar), 29_900);
        assert_eq!(Currency::Zar.code(), "ZAR");
        assert!(find_pack("made-up-pack").is_none());
    }
}
