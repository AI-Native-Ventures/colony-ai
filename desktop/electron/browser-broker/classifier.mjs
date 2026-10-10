import { containsSecret, redactText, sanitizeUntrusted } from "./redaction.mjs";

/**
 * Consequential action classifier. Pure. Decides, from structure first and
 * accessible names second, whether an agent action is allowed, needs the
 * person's explicit confirmation, or is refused outright.
 *
 * Input
 *   action   "click" | "type" | "select" | "upload" | "scroll" | "wait" |
 *            "read" | "snapshot" | "screenshot" | "navigate" | "tabs"
 *   element  { role, name, description, value, inputType, autocomplete,
 *              buttonType, href, inDialog, dialogRole, dialogText }
 *   form     { action, method, fields: [{ role, name, inputType, autocomplete }] }
 *            for the form that contains the element, or null
 *   page     { origin }
 *   submit   true when a `type` action also submits (Enter)
 *   text     the text being typed
 *
 * Output { decision: "allow" | "confirm" | "deny", category, reasons }
 * where each reason is { code, detail }. Page text is only ever matched
 * against fixed patterns; it is never interpreted as an instruction.
 */

const READ_ONLY_ACTIONS = new Set([
  "scroll",
  "wait",
  "read",
  "snapshot",
  "screenshot",
  "navigate",
  "tabs",
]);

/** Credential autocomplete tokens shared with the fixed screenshot function. */
export const CREDENTIAL_AUTOCOMPLETE = new Set([
  "cc-number",
  "cc-csc",
  "cc-exp",
  "cc-exp-month",
  "cc-exp-year",
  "cc-name",
  "cc-given-name",
  "cc-additional-name",
  "cc-family-name",
  "cc-type",
  "current-password",
  "new-password",
  "one-time-code",
]);

const INPUT_ROLES = new Set([
  "textbox",
  "searchbox",
  "spinbutton",
  "combobox",
  "listbox",
  "slider",
  "textarea",
  "input",
]);

const NAME_CAP = 300;

// Cyrillic and Greek look-alikes folded to Latin so "Pay" cannot be spelled
// with borrowed letters to dodge the name patterns.
/** Fixed character folds shared with the isolated screenshot masking function. */
export const CONFUSABLES = new Map(
  Object.entries({
    а: "a",
    е: "e",
    о: "o",
    р: "p",
    с: "c",
    у: "y",
    х: "x",
    і: "i",
    ј: "j",
    ѕ: "s",
    ԁ: "d",
    һ: "h",
    в: "b",
    н: "h",
    к: "k",
    м: "m",
    т: "t",
    ο: "o",
    α: "a",
    ρ: "p",
    ν: "v",
    τ: "t",
    ι: "i",
    κ: "k",
  }),
);

function fold(text) {
  let out = "";
  for (const character of sanitizeUntrusted(text, NAME_CAP).toLowerCase())
    out += CONFUSABLES.get(character) ?? character;
  return out;
}

const words = (list) =>
  new RegExp(
    `(?<![\\p{L}\\p{N}])(?:${list.join("|")})(?![\\p{L}\\p{N}])`,
    "iu",
  );

/** Credential label pattern shared by action policy and screenshot masking. */
export const CREDENTIAL_NAME = words([
  "pass(?:word|code|phrase|wd)?",
  "pwd",
  "pin(?: code| number)?",
  "cvv2?",
  "cvc2?",
  "csc",
  "cvn",
  "security code",
  "card (?:number|no|num)",
  "(?:credit|debit) card",
  "card ?holder",
  "name on card",
  "expir(?:y|ation|es)(?: date)?",
  "mm ?/ ?yy(?:yy)?",
  "one[- ]time(?: code| password)?",
  "otp",
  "2fa",
  "two[- ]factor",
  "verification code",
  "authenticator",
  "iban",
  "routing number",
  "account number",
  "sort code",
  "ssn",
  "social security",
  "secret",
  "api key",
  "private key",
  "seed phrase",
  "recovery (?:phrase|code)",
]);

const CATEGORY_PATTERNS = [
  [
    "payment",
    words([
      "buy(?: now| it now)?",
      "pay(?: now| securely| with [\\p{L}\\p{N} ]{1,20})?",
      "purchase",
      "place (?:your |the )?order",
      "order now",
      "submit order",
      "check ?out",
      "complete (?:order|purchase|payment|checkout)",
      "confirm (?:order|payment|purchase)",
      "make (?:a )?payment",
      "submit payment",
      "add (?:a )?(?:payment|card)(?: method)?",
      "subscribe",
      "donate",
      "start (?:your )?(?:free )?trial",
      "upgrade(?: now| plan)?",
      "renew(?: now)?",
      "top ?up",
      "add funds",
      "deposit",
      "comprar",
      "pagar",
      "realizar pedido",
      "suscribirse",
      "acheter",
      "payer",
      "commander",
      "passer la commande",
      "s'abonner",
      "kaufen",
      "jetzt kaufen",
      "bezahlen",
      "bestellen",
      "finalizar compra",
      "koop",
      "betaal",
      "bestel",
    ]),
  ],
  [
    "transfer",
    words([
      "transfer(?: funds| money)?",
      "withdraw(?:al)?",
      "send money",
      "wire(?: transfer)?",
      "cash ?out",
      "pay ?out",
    ]),
  ],
  [
    "destructive",
    words([
      "delete(?: account| all| forever| permanently)?",
      "erase",
      "destroy",
      "wipe",
      "remove (?:account|all|permanently)",
      "close (?:my |your )?account",
      "deactivate",
      "cancel (?:my |your )?(?:subscription|plan|membership|order|account)",
      "terminate",
      "revoke",
      "eliminar",
      "supprimer",
      "l(?:ö|o)schen",
      "excluir",
      "vee uit",
    ]),
  ],
  [
    "send_or_post",
    words([
      "send(?: message| email| invite| reply| now)?",
      "post(?: now| reply| comment)?",
      "publish",
      "tweet",
      "reply",
      "comment",
      "share",
      "invite",
      "submit(?: application| form| request)?",
      "apply(?: now)?",
      "reserve",
      "book(?: now)?",
      "rsvp",
      "confirm",
      "sign (?:up|the document)",
      "e-?sign",
      "register",
      "create (?:an? )?account",
      "enviar",
      "publicar",
      "envoyer",
      "publier",
      "senden",
      "ver(?:ö|o)ffentlichen",
      "stuur",
    ]),
  ],
  [
    "permission",
    words([
      "allow(?: all| access| notifications)?",
      "grant(?: access| permission)?",
      "authori[sz]e",
      "accept(?: all| and continue| invitation| request)?",
      "agree(?: and continue)?",
      "i agree",
      "consent",
      "connect(?: account)?",
      "link (?:account|my account)",
      "install",
      "enable(?: notifications| location)?",
      "approve",
      "trust(?: this (?:device|browser))?",
      "aceptar",
      "autorizar",
      "permitir",
      "accepter",
      "autoriser",
      "akzeptieren",
      "zustimmen",
      "erlauben",
      "aceitar",
    ]),
  ],
];

const COOKIE_BANNER = /cookie/iu;
const AFFIRMATIVE =
  /^(?:ok|okay|yes|yep|continue|confirm|proceed|accept|allow|agree|got it|done)$/iu;
const PERMISSION_DIALOG =
  /(allow|permission|access to|location|camera|microphone|notifications?|wants to|would like to|share your|authori[sz]e|grant)/iu;

/** True for fields whose value is a credential or payment detail. */
export function isCredentialField({
  role,
  inputType,
  autocomplete,
  name,
} = {}) {
  if (String(inputType ?? "").toLowerCase() === "password") return true;
  for (const token of String(autocomplete ?? "")
    .toLowerCase()
    .split(/\s+/u))
    if (CREDENTIAL_AUTOCOMPLETE.has(token)) return true;
  const kind = String(role ?? "").toLowerCase();
  const inputLike =
    INPUT_ROLES.has(kind) ||
    (inputType !== undefined &&
      ![
        "button",
        "submit",
        "reset",
        "image",
        "checkbox",
        "radio",
        "file",
        "hidden",
      ].includes(String(inputType).toLowerCase()));
  if (!inputLike) return false;
  return CREDENTIAL_NAME.test(fold(name ?? ""));
}

/** Category of a control by its accessible name, or null. */
export function consequentialCategory(name) {
  const text = fold(name ?? "");
  if (text.length === 0) return null;
  for (const [category, pattern] of CATEGORY_PATTERNS) {
    if (!pattern.test(text)) continue;
    if (category === "permission" && COOKIE_BANNER.test(text)) return null;
    return category;
  }
  return null;
}

function labelOf(element) {
  return [element?.name, element?.value, element?.description]
    .filter((part) => typeof part === "string" && part.length > 0)
    .join(" ");
}

function isSubmitControl(element, form) {
  if (!form) return false;
  const role = String(element?.role ?? "").toLowerCase();
  const inputType = String(element?.inputType ?? "").toLowerCase();
  const buttonType = String(element?.buttonType ?? "").toLowerCase();
  if (inputType === "submit" || inputType === "image") return true;
  if (role === "button" && (buttonType === "submit" || buttonType === ""))
    return true;
  return false;
}

function crossOriginAction(form, page) {
  if (!form?.action || !page?.origin) return false;
  try {
    return new URL(form.action, page.origin).origin !== page.origin;
  } catch {
    return true;
  }
}

function externalProtocol(href) {
  if (typeof href !== "string" || href.length === 0) return null;
  const match = /^([a-z][a-z0-9+.-]*):/iu.exec(href.trim());
  if (!match) return null;
  const scheme = match[1].toLowerCase();
  return scheme === "http" || scheme === "https" ? null : scheme;
}

/** Classify one agent action. See the file header for the input contract. */
export function classifyAction({
  action,
  element = {},
  form = null,
  page = {},
  submit = false,
  text = "",
} = {}) {
  const deny = [];
  const confirm = [];
  const add = (list, code, detail) => list.push({ code, detail });
  let category = null;

  if (READ_ONLY_ACTIONS.has(action))
    return { decision: "allow", category: null, reasons: [] };

  const credentialElement = isCredentialField(element);
  const isTyping = action === "type";
  const isSelect = action === "select";

  if ((isTyping || isSelect) && credentialElement)
    add(
      deny,
      "credential_field",
      "The person enters credentials and payment details",
    );
  if (isTyping && containsSecret(text))
    add(
      deny,
      "secret_in_text",
      "Text that looks like a secret cannot be typed into a page",
    );

  if (action === "download") {
    const scheme = externalProtocol(element.href);
    if (!element.href || scheme)
      add(
        deny,
        "external_protocol_link",
        "Only direct HTTP(S) download links are allowed",
      );
    add(confirm, "file_download", "Downloading saves a file on this device");
  }

  if (action === "upload")
    add(confirm, "file_upload", "Uploading a file shares it with the site");

  if (action === "click") {
    if (String(element.inputType ?? "").toLowerCase() === "file")
      add(
        deny,
        "use_upload_tool",
        "File choosers open through the upload tool",
      );
    const scheme = externalProtocol(element.href);
    if (scheme)
      add(
        deny,
        "external_protocol_link",
        `Links that open ${scheme}: are not followed`,
      );
  }

  const submitting =
    (action === "click" && isSubmitControl(element, form)) ||
    (isTyping && submit === true && form !== null);

  if (action === "click" || (isTyping && submit === true)) {
    const named =
      action === "click" ? consequentialCategory(labelOf(element)) : null;
    if (named) {
      category = named;
      add(confirm, named, "The control name indicates a consequential action");
    }
    if (submitting && form) {
      const credentialForm = (form.fields ?? []).some(isCredentialField);
      if (credentialForm) {
        category ??= "credential_form";
        add(
          confirm,
          "credential_form_submit",
          "The form contains credential or payment fields",
        );
      }
      if (crossOriginAction(form, page)) {
        category ??= "cross_origin_form";
        add(
          confirm,
          "cross_origin_form",
          "The form submits to a different site",
        );
      }
    }
    if (action === "click" && element.inDialog) {
      const label = fold(labelOf(element));
      const permissionish = PERMISSION_DIALOG.test(
        fold(element.dialogText ?? ""),
      );
      if (
        element.dialogRole === "alertdialog" ||
        (permissionish && AFFIRMATIVE.test(label))
      ) {
        if (AFFIRMATIVE.test(label) || consequentialCategory(label)) {
          category ??= permissionish ? "permission" : "dialog";
          add(
            confirm,
            "dialog_confirm",
            "A dialog asks to confirm an action or permission",
          );
        }
      }
    }
  }

  if (deny.length > 0)
    return { decision: "deny", category, reasons: [...deny, ...confirm] };
  if (confirm.length > 0)
    return { decision: "confirm", category, reasons: confirm };
  return { decision: "allow", category: null, reasons: [] };
}

/** One redacted line the UI can show when asking the person to confirm. */
export function confirmationSummary(
  { action, element = {}, page = {}, text } = {},
  result,
) {
  const label =
    sanitizeUntrusted(labelOf(element), 80) || element.role || "control";
  const verb =
    action === "type"
      ? "Type into"
      : action === "upload"
        ? "Upload to"
        : action === "download"
          ? "Download from"
          : "Click";
  const where = page.origin ? ` on ${page.origin}` : "";
  const typed =
    action === "type" && typeof text === "string"
      ? ` (${text.length} characters)`
      : "";
  const why = (result?.reasons ?? []).map((reason) => reason.code).join(", ");
  return redactText(
    `${verb} "${label}"${typed}${where}${why ? ` [${why}]` : ""}`,
    400,
  );
}
