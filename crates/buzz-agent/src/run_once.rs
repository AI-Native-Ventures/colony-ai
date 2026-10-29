//! `buzz-agent run-once`: one budgeted model call with no tools.
//!
//! Worker runs (`colony workers spawn`) use this instead of an ACP session.
//! The call uses the provider the employee already runs on, offers the model
//! no tools and starts no MCP server, so a worker can only write text. A tool
//! call the model makes anyway is refused and the run goes on to an answer.
//! The result is one JSON line on stdout; the answer goes to `--output-file`.

use std::path::PathBuf;
use std::time::Duration;

use serde_json::json;

use crate::config::Config;
use crate::llm::Llm;
use crate::types::HistoryItem;

const WORKER_SYSTEM_PROMPT: &str =
    "You are a research and drafting worker for a company employee. \
You have no tools, no browser and no shell, and you cannot act, send or spend. \
Answer the brief in plain text, concisely, with the answer first. \
If the brief needs something you cannot do without tools, say what is missing instead of guessing.";

const NO_TOOLS_NOTICE: &str = "You have no tools in this run, and nothing you call will run. \
Do not call tools. Answer the brief now in plain text.";

/// Largest prompt file the worker reads, in bytes.
const MAX_PROMPT_BYTES: u64 = 262_144;
const MAX_ROUNDS: u32 = 8;
const MAX_OUTPUT_TOKENS: u32 = 16_000;
const MAX_TIMEOUT_SECS: u64 = 900;

/// Parsed `run-once` flags.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RunOnceArgs {
    pub prompt_file: PathBuf,
    pub output_file: PathBuf,
    pub max_rounds: u32,
    pub max_output_tokens: u32,
    pub timeout_secs: u64,
}

pub(crate) fn parse_args(args: &[String]) -> Result<RunOnceArgs, String> {
    let mut prompt_file = None;
    let mut output_file = None;
    let mut max_rounds = None;
    let mut max_output_tokens = None;
    let mut timeout_secs = None;
    let mut iter = args.iter();
    while let Some(flag) = iter.next() {
        let value = iter
            .next()
            .ok_or_else(|| format!("run-once: {flag} needs a value"))?;
        let number = |name: &str| {
            value
                .parse::<u64>()
                .map_err(|_| format!("run-once: {name} must be a whole number, got {value}"))
        };
        match flag.as_str() {
            "--prompt-file" => prompt_file = Some(PathBuf::from(value)),
            "--output-file" => output_file = Some(PathBuf::from(value)),
            "--max-rounds" => max_rounds = Some(number("--max-rounds")?),
            "--max-output-tokens" => max_output_tokens = Some(number("--max-output-tokens")?),
            "--timeout-secs" => timeout_secs = Some(number("--timeout-secs")?),
            other => return Err(format!("run-once: unknown flag {other}")),
        }
    }
    let missing = |name: &str| format!("run-once: {name} is required");
    let max_rounds = max_rounds.ok_or_else(|| missing("--max-rounds"))?;
    let max_output_tokens = max_output_tokens.ok_or_else(|| missing("--max-output-tokens"))?;
    let timeout_secs = timeout_secs.ok_or_else(|| missing("--timeout-secs"))?;
    if !(1..=u64::from(MAX_ROUNDS)).contains(&max_rounds) {
        return Err(format!("run-once: --max-rounds must be 1 to {MAX_ROUNDS}"));
    }
    if !(1..=u64::from(MAX_OUTPUT_TOKENS)).contains(&max_output_tokens) {
        return Err(format!(
            "run-once: --max-output-tokens must be 1 to {MAX_OUTPUT_TOKENS}"
        ));
    }
    if !(1..=MAX_TIMEOUT_SECS).contains(&timeout_secs) {
        return Err(format!(
            "run-once: --timeout-secs must be 1 to {MAX_TIMEOUT_SECS}"
        ));
    }
    Ok(RunOnceArgs {
        prompt_file: prompt_file.ok_or_else(|| missing("--prompt-file"))?,
        output_file: output_file.ok_or_else(|| missing("--output-file"))?,
        // The ranges above make these conversions lossless.
        max_rounds: max_rounds as u32,
        max_output_tokens: max_output_tokens as u32,
        timeout_secs,
    })
}

#[derive(Debug, Default, Clone, Copy)]
struct Usage {
    input: u64,
    output: u64,
}

/// The line `run-once` prints.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Report {
    pub done: bool,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub error: Option<String>,
}

impl Report {
    fn failed(error: impl Into<String>, usage: Usage) -> Self {
        Self {
            done: false,
            input_tokens: usage.input,
            output_tokens: usage.output,
            error: Some(error.into()),
        }
    }

    pub(crate) fn line(&self) -> String {
        json!({
            "status": if self.done { "done" } else { "failed" },
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "error": self.error,
        })
        .to_string()
    }
}

/// Entry point for `buzz-agent run-once <flags>`.
pub(crate) fn run_once_command(args: &[String]) -> Result<(), Box<dyn std::error::Error>> {
    let report = match parse_args(args) {
        Ok(parsed) => tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()?
            .block_on(execute(parsed)),
        Err(error) => Report::failed(error, Usage::default()),
    };
    println!("{}", report.line());
    match report.error {
        None => Ok(()),
        Some(error) => Err(error.into()),
    }
}

async fn execute(args: RunOnceArgs) -> Report {
    let mut usage = Usage::default();
    let prompt = match read_prompt(&args) {
        Ok(prompt) => prompt,
        Err(error) => return Report::failed(error, usage),
    };
    let mut cfg = match Config::from_env() {
        Ok(cfg) => cfg,
        Err(error) => return Report::failed(error, usage),
    };
    let llm = match Llm::new(&cfg) {
        Ok(llm) => llm,
        Err(error) => return Report::failed(error.to_string(), usage),
    };
    let answered = tokio::time::timeout(
        Duration::from_secs(100_000),
        answer(&cfg, &llm, &prompt, args.max_rounds, &mut usage),
    )
    .await;
    let text = match answered {
        Err(_) => {
            return Report::failed(
                format!(
                    "The worker ran out of time ({} seconds).",
                    args.timeout_secs
                ),
                usage,
            )
        }
        Ok(Err(error)) => return Report::failed(error, usage),
        Ok(Ok(text)) => text,
    };
    if let Err(error) = std::fs::write(&args.output_file, &text) {
        return Report::failed(
            format!(
                "The worker's answer could not be saved to {}: {error}",
                args.output_file.display()
            ),
            usage,
        );
    }
    Report {
        done: true,
        input_tokens: usage.input,
        output_tokens: usage.output,
        error: None,
    }
}

fn read_prompt(args: &RunOnceArgs) -> Result<String, String> {
    let size = std::fs::metadata(&args.prompt_file)
        .map_err(|error| format!("The brief could not be read: {error}"))?
        .len();
    if size > MAX_PROMPT_BYTES {
        return Err(format!(
            "The brief is {size} bytes; at most {MAX_PROMPT_BYTES}."
        ));
    }
    let prompt = std::fs::read_to_string(&args.prompt_file)
        .map_err(|error| format!("The brief could not be read: {error}"))?;
    if prompt.trim().is_empty() {
        return Err("The brief is empty.".to_owned());
    }
    Ok(prompt)
}

/// Ask the model until it answers in text. Offers no tools; a tool call is
/// refused with a notice and costs one of the rounds.
async fn answer(
    cfg: &Config,
    llm: &Llm,
    prompt: &str,
    max_rounds: u32,
    usage: &mut Usage,
) -> Result<String, String> {
    let mut history = vec![HistoryItem::User(prompt.to_owned())];
    for _ in 0..max_rounds {
        let response = llm
            .complete(cfg, WORKER_SYSTEM_PROMPT, &history, &[], &cfg.model)
            .await
            .map_err(|error| error.to_string())?;
        usage.input = usage
            .input
            .saturating_add(response.input_tokens.unwrap_or(0));
        usage.output = usage
            .output
            .saturating_add(response.output_tokens.unwrap_or(0));
        if response.tool_calls.is_empty() {
            if response.text.trim().is_empty() {
                return Err("The model returned no text.".to_owned());
            }
            return Ok(response.text);
        }
        // The refused call is not replayed: some providers reject tool-use
        // blocks in a request that defines no tools.
        let said = if response.text.trim().is_empty() {
            "(tool call refused)".to_owned()
        } else {
            response.text
        };
        history.push(HistoryItem::Assistant {
            text: said,
            tool_calls: Vec::new(),
            reasoning_details: None,
        });
    }
    Err(format!(
        "The model kept calling tools and gave no answer in {max_rounds} rounds."
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn flags(extra: &[(&str, &str)]) -> Vec<String> {
        let mut base = vec![
            ("--prompt-file", "/tmp/p.txt"),
            ("--output-file", "/tmp/o.txt"),
            ("--max-rounds", "4"),
            ("--max-output-tokens", "4000"),
            ("--timeout-secs", "600"),
        ];
        for &(name, value) in extra {
            base.retain(|(existing, _)| *existing != name);
            base.push((name, value));
        }
        base.into_iter()
            .flat_map(|(name, value)| [name.to_owned(), value.to_owned()])
            .collect()
    }

    #[test]
    fn parses_the_documented_flags() {
        let parsed = parse_args(&flags(&[])).expect("parse");
        assert_eq!(parsed.max_rounds, 4);
        assert_eq!(parsed.max_output_tokens, 4000);
        assert_eq!(parsed.timeout_secs, 600);
        assert_eq!(parsed.output_file, PathBuf::from("/tmp/o.txt"));
    }

    #[test]
    fn refuses_budgets_outside_the_worker_limits() {
        assert!(parse_args(&flags(&[("--max-rounds", "9")])).is_err());
        assert!(parse_args(&flags(&[("--max-rounds", "0")])).is_err());
        assert!(parse_args(&flags(&[("--max-output-tokens", "16001")])).is_err());
        assert!(parse_args(&flags(&[("--timeout-secs", "901")])).is_err());
        assert!(parse_args(&flags(&[("--timeout-secs", "abc")])).is_err());
    }

    #[test]
    fn refuses_unknown_and_missing_flags() {
        let mut unknown = flags(&[]);
        unknown.extend(["--with-tools".to_owned(), "yes".to_owned()]);
        assert!(parse_args(&unknown).is_err());
        let missing: Vec<String> = flags(&[]).into_iter().skip(2).collect();
        assert!(parse_args(&missing).is_err());
    }

    #[test]
    fn the_report_line_is_one_json_object() {
        let done = Report {
            done: true,
            input_tokens: 5,
            output_tokens: 6,
            error: None,
        };
        let value: serde_json::Value = serde_json::from_str(&done.line()).expect("json");
        assert_eq!(value["status"], "done");
        assert!(value["error"].is_null());
        let failed = Report::failed(
            "boom",
            Usage {
                input: 1,
                output: 2,
            },
        );
        let value: serde_json::Value = serde_json::from_str(&failed.line()).expect("json");
        assert_eq!(value["status"], "failed");
        assert_eq!(value["error"], "boom");
        assert_eq!(value["output_tokens"], 2);
    }
}
