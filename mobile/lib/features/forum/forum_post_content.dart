/// Headline and body serialized into one existing forum post's content.
typedef ForumPostContent = ({String title, String body});

/// Splits the headline/body format written by the mobile forum composer.
///
/// Posts without a blank line remain body-only content, including multiline
/// messages that were not created by the headline composer.
ForumPostContent parseForumPostContent(String content) {
  final normalized = content.trim();
  final separator = RegExp(r'\r?\n\s*\r?\n').firstMatch(normalized);
  if (separator == null) return (title: '', body: normalized);
  return (
    title: normalized.substring(0, separator.start).trim(),
    body: normalized.substring(separator.end).trim(),
  );
}
