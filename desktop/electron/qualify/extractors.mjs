export const QUALIFY_SIGNALS = Object.freeze([
  "NO_WEBSITE",
  "SITE_DOWN",
  "NO_HTTPS",
  "NOT_MOBILE_FRIENDLY",
  "NO_ONLINE_BOOKING",
  "NO_WHATSAPP_LINK",
  "HAS_WHATSAPP_LINK",
  "RUNNING_ADS",
  "STALE_SITE",
  "SITE_BUILDER",
  "INCUMBENT_BUILDER",
  "SOCIAL_LINKS",
  "PUBLIC_EMAIL",
]);

export const RECOMMENDED_QUALIFY_SIGNALS = Object.freeze(
  QUALIFY_SIGNALS.slice(0, 7),
);

/** The v1 selection starts fully disabled and carries no selected checks. */
export const DEFAULT_QUALIFY_SELECTION = Object.freeze({
  enabled: false,
  signals: Object.freeze([]),
});

/** Plain-language metadata belongs next to the signals, not inside a UI component. */
export const QUALIFY_SIGNAL_DEFINITIONS = Object.freeze({
  NO_WEBSITE: {
    label: "No website",
    meaning: "Google Maps has no real business website.",
    limit: "A social or directory profile is not treated as a website.",
  },
  SITE_DOWN: {
    label: "Website not loading",
    meaning: "The homepage could not be reached.",
    limit: "This does not describe any page content.",
  },
  NO_HTTPS: {
    label: "Not secure",
    meaning: "The homepage ended on HTTP rather than HTTPS.",
    limit: "It is based on the final fetched homepage URL.",
  },
  NOT_MOBILE_FRIENDLY: {
    label: "Hard to use on a phone",
    meaning: "The homepage lacks basic responsive hints.",
    limit: "Static HTML cannot prove every mobile layout problem.",
  },
  NO_ONLINE_BOOKING: {
    label: "No booking found",
    meaning: "No booking option was found in the bounded pages checked.",
    limit: "This is never phrased as a claim that customers cannot book.",
  },
  NO_WHATSAPP_LINK: {
    label: "No WhatsApp button found",
    meaning: "No WhatsApp link appeared in the static pages checked.",
    limit: "A JavaScript-only button can be missed.",
  },
  HAS_WHATSAPP_LINK: {
    label: "Has a WhatsApp button",
    meaning: "A WhatsApp link appeared in the checked pages.",
    limit: "The stored link is the evidence.",
  },
  RUNNING_ADS: {
    label: "Ad markers found",
    meaning: "Google Ads or Meta pixel markers appeared in page source.",
    limit: "A marker does not prove a current campaign is spending.",
  },
  STALE_SITE: {
    label: "Looks out of date",
    meaning: "A dated copyright or post suggests an older site.",
    limit: "Only dates visible in fetched content are considered.",
  },
  SITE_BUILDER: {
    label: "Built with a site builder",
    meaning: "A known builder marker appeared in page source.",
    limit: "The marker may be historical or supplied by a theme.",
  },
  INCUMBENT_BUILDER: {
    label: "Built by another provider",
    meaning: "A credible footer credit names another builder or agency.",
    limit: "Ambiguous credits are intentionally omitted.",
  },
  SOCIAL_LINKS: {
    label: "Social pages found",
    meaning: "Facebook or Instagram links appeared on the business site.",
    limit: "The links are evidence for later social work only.",
  },
  PUBLIC_EMAIL: {
    label: "Public contact email",
    meaning: "An email address appeared in fetched page content.",
    limit: "It is not used to send email in v1.",
  },
});

const NON_SITE_HOSTS = [
  "facebook.com",
  "fb.com",
  "instagram.com",
  "linktr.ee",
  "beacons.ai",
  "bio.link",
  "yellowpages.com",
  "yellowpages.co.za",
  "yelp.com",
  "foursquare.com",
];
const BOOKING_MARKERS = [
  "booksy",
  "calendly",
  "acuityscheduling",
  "setmore",
  "simplybook",
  "mindbody",
  "fresha",
  "squareup.com/appointments",
  "booking",
  "book-now",
  "book_now",
];
const SITE_BUILDERS = [
  ["WordPress", /wordpress|wp-content/i],
  ["Wix", /wixstatic|wix\.com/i],
  ["Squarespace", /squarespace/i],
  ["Shopify", /shopify/i],
  ["Webflow", /webflow/i],
  ["Weebly", /weebly/i],
];
const GENERIC_EMAIL_PREFIXES = new Set([
  "admin",
  "bookings",
  "contact",
  "enquiries",
  "hello",
  "info",
  "office",
  "sales",
  "support",
  "team",
]);

function selectedSignals(input) {
  const values = [...new Set(input ?? [])].filter((signal) =>
    QUALIFY_SIGNALS.includes(signal),
  );
  return new Set(values);
}

function pageHtml(page) {
  return typeof page?.html === "string" ? page.html : "";
}

function pageUrls(pages) {
  return pages.map((page) => page.url).filter((url) => typeof url === "string");
}

function observed(
  signal,
  value,
  confidence,
  evidenceUrls,
  observedAt,
  personalData = false,
) {
  return {
    signal,
    state: "observed",
    value,
    confidence,
    evidenceUrls: [...new Set(evidenceUrls)],
    observedAt,
    personalData,
  };
}

function notChecked(signal, reason, observedAt) {
  return {
    signal,
    state: "not_checked",
    value: null,
    confidence: 0,
    evidenceUrls: [],
    observedAt,
    notCheckedReason: reason,
    personalData: false,
  };
}

function stripHtml(html) {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
}

function linksFromPage(page) {
  const links = [];
  for (const match of pageHtml(page).matchAll(
    /\bhref\s*=\s*["']([^"']+)["']/gi,
  )) {
    try {
      links.push(new URL(match[1], page.url).toString());
    } catch {
      // An invalid page link is not evidence and is never fetched.
    }
  }
  return links;
}

/** True when a Maps URL is not a business-owned website for qualification. */
export function isNonSiteWebsiteUrl(value) {
  try {
    const host = new URL(value).hostname.toLocaleLowerCase();
    return NON_SITE_HOSTS.some(
      (domain) => host === domain || host.endsWith(`.${domain}`),
    );
  } catch {
    return true;
  }
}

function viewportPresent(html) {
  return /<meta\b[^>]*\bname\s*=\s*["']?viewport["']?[^>]*>/i.test(html);
}

function responsiveHintPresent(html) {
  return /@media\b|\b(?:bootstrap|tailwind|responsive)\b|\bmedia\s*=\s*["'][^"']+["']/i.test(
    html,
  );
}

function whatsappLinks(pages) {
  return pages.flatMap((page) =>
    linksFromPage(page).filter((link) => {
      try {
        const host = new URL(link).hostname.toLocaleLowerCase();
        return (
          host === "wa.me" ||
          host === "api.whatsapp.com" ||
          host.endsWith(".whatsapp.com")
        );
      } catch {
        return false;
      }
    }),
  );
}

function bookingFound(pages) {
  return pages.some((page) => {
    const content =
      `${pageHtml(page)} ${linksFromPage(page).join(" ")}`.toLocaleLowerCase();
    return BOOKING_MARKERS.some((marker) => content.includes(marker));
  });
}

function socialLinks(pages) {
  return pages.flatMap((page) =>
    linksFromPage(page).filter((link) => {
      try {
        const host = new URL(link).hostname.toLocaleLowerCase();
        return (
          host === "facebook.com" ||
          host.endsWith(".facebook.com") ||
          host === "instagram.com" ||
          host.endsWith(".instagram.com")
        );
      } catch {
        return false;
      }
    }),
  );
}

function publicEmails(pages) {
  const matches = [];
  const expression = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,63}/gi;
  for (const page of pages) {
    for (const match of pageHtml(page).matchAll(expression)) {
      matches.push({ email: match[0].toLocaleLowerCase(), url: page.url });
    }
  }
  return matches;
}

function looksPersonalEmail(email) {
  const local = email.split("@", 1)[0].toLocaleLowerCase();
  if (GENERIC_EMAIL_PREFIXES.has(local)) return false;
  return /^[a-z]{2,24}[._-][a-z]{2,24}$/.test(local);
}

function staleDate(pages, nowSeconds) {
  const now = new Date(nowSeconds * 1_000);
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - 18);
  const currentYear = now.getUTCFullYear();
  for (const page of pages) {
    const html = pageHtml(page);
    const copyrightYears = [
      ...html.matchAll(
        /(?:©|&copy;|copyright)[^<\n]{0,100}\b((?:19|20)\d{2})\b/gi,
      ),
    ].map((match) => Number(match[1]));
    if (
      copyrightYears.length > 0 &&
      Math.max(...copyrightYears) <= currentYear - 2
    ) {
      return {
        value: `Copyright ${Math.max(...copyrightYears)}`,
        url: page.url,
      };
    }
    const dates = [
      ...html.matchAll(/\b(20\d{2}-\d{2}-\d{2})\b/g),
      ...html.matchAll(
        /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},\s+20\d{2}\b/gi,
      ),
    ]
      .map((match) => new Date(match[0]))
      .filter((date) => Number.isFinite(date.getTime()));
    if (
      dates.length > 0 &&
      Math.max(...dates.map((date) => date.getTime())) < cutoff.getTime()
    ) {
      return {
        value: "Latest dated post is older than 18 months",
        url: page.url,
      };
    }
  }
  return null;
}

function siteBuilder(pages) {
  for (const page of pages) {
    for (const [name, marker] of SITE_BUILDERS) {
      if (marker.test(pageHtml(page))) return { value: name, url: page.url };
    }
  }
  return null;
}

function incumbentBuilder(pages) {
  for (const page of pages) {
    const text = stripHtml(pageHtml(page));
    const match = text.match(
      /(?:website|site|web design|designed|built)\s+(?:by|with)\s+([a-z0-9][a-z0-9 .&'-]{1,80})/i,
    );
    if (!match) continue;
    const candidate = match[1]
      .trim()
      .replace(/\s+(?:all rights reserved|copyright).*$/i, "");
    if (
      candidate.length < 2 ||
      SITE_BUILDERS.some(
        ([name]) => name.toLocaleLowerCase() === candidate.toLocaleLowerCase(),
      )
    ) {
      continue;
    }
    return { value: candidate, url: page.url };
  }
  return null;
}

function siteDownOutcome(outcome) {
  return [
    "site_down",
    "dns_failure",
    "timeout",
    "tls_failure",
    "http_5xx",
  ].includes(outcome?.reason);
}

/**
 * Extract only selected v1 facts from Maps metadata and bounded fetched pages.
 * Every absent positive signal remains absent, but `checkedSignals` records that
 * the selected check completed so targeting can distinguish it from unchecked.
 */
export function extractQualificationSignals(input) {
  const selected = selectedSignals(input.selectedSignals);
  const checkedSignals = [...selected];
  const observedAt = input.observedAt;
  const website =
    typeof input.maps?.website === "string" ? input.maps.website.trim() : "";
  const pages = Array.isArray(input.pages)
    ? input.pages
        .slice(0, 5)
        .filter((page) => page?.url && typeof pageHtml(page) === "string")
    : [];
  const evidenceUrls = pageUrls(pages);
  const observations = [];
  const add = (signal, value, confidence, evidence, personalData = false) => {
    if (selected.has(signal)) {
      observations.push(
        observed(signal, value, confidence, evidence, observedAt, personalData),
      );
    }
  };
  const unable = (reason, includeSiteDown = false) => {
    for (const signal of checkedSignals) {
      if (includeSiteDown && signal === "SITE_DOWN") {
        observations.push(
          observed(
            signal,
            "Homepage did not load",
            0.95,
            website ? [website] : [],
            observedAt,
          ),
        );
      } else {
        observations.push(notChecked(signal, reason, observedAt));
      }
    }
  };

  if (checkedSignals.length === 0) return { checkedSignals, observations };
  if (!website || isNonSiteWebsiteUrl(website)) {
    if (selected.has("NO_WEBSITE")) {
      add(
        "NO_WEBSITE",
        website
          ? "Maps website is a social, link-in-bio, or directory page"
          : "No website URL in Google Maps",
        1,
        website ? [website] : [],
      );
    }
    for (const signal of checkedSignals) {
      if (signal !== "NO_WEBSITE")
        observations.push(notChecked(signal, "no_website", observedAt));
    }
    return { checkedSignals, observations };
  }
  if (input.outcome?.kind !== "success") {
    unable(
      input.outcome?.reason ?? "not_checked",
      siteDownOutcome(input.outcome),
    );
    return { checkedSignals, observations };
  }
  if (pages.length === 0) {
    unable("no_fetched_pages");
    return { checkedSignals, observations };
  }

  const combined = pages.map((page) => pageHtml(page)).join("\n");
  const homepage = pageHtml(pages[0]);
  if (input.finalProtocol === "http:" || input.downgradedFromHttps) {
    add("NO_HTTPS", "Homepage uses HTTP", 0.95, [pages[0].url]);
  }
  if (!viewportPresent(homepage) && !responsiveHintPresent(homepage)) {
    add(
      "NOT_MOBILE_FRIENDLY",
      "No viewport or responsive stylesheet hint found",
      0.65,
      [pages[0].url],
    );
  }
  if (!bookingFound(pages)) {
    add("NO_ONLINE_BOOKING", "No booking found", 0.6, evidenceUrls);
  }
  const whatsapp = whatsappLinks(pages);
  if (whatsapp.length > 0) {
    add("HAS_WHATSAPP_LINK", whatsapp[0], 0.95, whatsapp);
  } else {
    add(
      "NO_WHATSAPP_LINK",
      "No WhatsApp link found in static page content",
      0.7,
      evidenceUrls,
    );
  }
  if (
    /googleadservices|\bAW-\d+|gtag\s*\([^)]*['"]AW-|fbq\s*\(|fbevents\.js/i.test(
      combined,
    )
  ) {
    add("RUNNING_ADS", "Google Ads or Meta pixel marker found", 0.9, [
      pages[0].url,
    ]);
  }
  const stale = staleDate(pages, observedAt);
  if (stale) add("STALE_SITE", stale.value, 0.8, [stale.url]);
  const builder = siteBuilder(pages);
  if (builder) add("SITE_BUILDER", builder.value, 0.9, [builder.url]);
  const incumbent = incumbentBuilder(pages);
  if (incumbent)
    add("INCUMBENT_BUILDER", incumbent.value, 0.75, [incumbent.url]);
  const social = socialLinks(pages);
  if (social.length > 0) add("SOCIAL_LINKS", social[0], 0.75, social);
  const emails = publicEmails(pages);
  if (emails.length > 0) {
    add(
      "PUBLIC_EMAIL",
      emails[0].email,
      0.9,
      [emails[0].url],
      looksPersonalEmail(emails[0].email),
    );
  }
  return { checkedSignals, observations };
}

/** Return same-site links that fit the bounded follow-up page policy. */
export function qualificationFollowupLinks(homepage, max = 4) {
  let origin;
  try {
    origin = new URL(homepage.url).origin;
  } catch {
    return [];
  }
  const candidates = linksFromPage(homepage).filter((link) => {
    try {
      const url = new URL(link);
      return (
        url.origin === origin &&
        /(?:contact|about|book|appointment|career|job)/i.test(
          `${url.pathname}${url.search}`,
        )
      );
    } catch {
      return false;
    }
  });
  return [...new Set(candidates)].slice(0, max);
}
