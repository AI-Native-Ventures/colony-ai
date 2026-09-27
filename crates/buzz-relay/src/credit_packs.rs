//! Fixed PayFast credit pack prices and grants.

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
    /// Credits added after a verified payment, in ledger nanoUSD.
    pub grant_nanousd: i64,
}

impl CreditPack {
    /// Amount charged in the provider's currency minor units.
    pub fn price_in(&self, _currency: Currency) -> i64 {
        self.zar_cents
    }
}

/// Currency charged by the configured provider.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum Currency {
    /// South African Rand.
    Zar,
}

impl Currency {
    /// ISO 4217 currency code.
    pub fn code(self) -> &'static str {
        match self {
            Currency::Zar => "ZAR",
        }
    }
}

/// Packs ordered from the smallest to largest purchase.
pub const CREDIT_PACKS: &[CreditPack] = &[
    CreditPack {
        id: "starter",
        name: "Starter",
        zar_cents: 11_900,
        grant_nanousd: 500 * NANO_USD_PER_CENT,
    },
    CreditPack {
        id: "growth",
        name: "Growth",
        zar_cents: 29_900,
        grant_nanousd: 1_400 * NANO_USD_PER_CENT,
    },
    CreditPack {
        id: "scale",
        name: "Scale",
        zar_cents: 89_900,
        grant_nanousd: 4_400 * NANO_USD_PER_CENT,
    },
    CreditPack {
        id: "pro",
        name: "Pro",
        zar_cents: 244_900,
        grant_nanousd: 12_000 * NANO_USD_PER_CENT,
    },
    CreditPack {
        id: "studio",
        name: "Studio",
        zar_cents: 508_900,
        grant_nanousd: 25_000 * NANO_USD_PER_CENT,
    },
    CreditPack {
        id: "agency",
        name: "Agency",
        zar_cents: 1_014_900,
        grant_nanousd: 50_000 * NANO_USD_PER_CENT,
    },
    CreditPack {
        id: "enterprise",
        name: "Enterprise",
        zar_cents: 2_024_900,
        grant_nanousd: 100_000 * NANO_USD_PER_CENT,
    },
];

/// Find a pack by its stable checkout identifier.
pub fn find_pack(id: &str) -> Option<&'static CreditPack> {
    CREDIT_PACKS.iter().find(|pack| pack.id == id)
}

#[cfg(test)]
mod tests {
    use super::*;

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
