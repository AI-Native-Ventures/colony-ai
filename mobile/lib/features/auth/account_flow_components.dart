import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../shared/theme/theme.dart';
import 'account_flow_palette.dart';

/// Small Colony mark used by the account welcome screen.
class AccountBrandMark extends StatelessWidget {
  const AccountBrandMark({super.key});

  @override
  Widget build(BuildContext context) => ExcludeSemantics(
    child: Align(
      alignment: Alignment.centerLeft,
      child: SvgPicture.string(_colonyMark, width: 50, height: 50),
    ),
  );
}

/// Google sign-in action shared by email and password account forms.
class AccountGoogleButton extends StatelessWidget {
  const AccountGoogleButton({
    required this.onPressed,
    this.isLoading = false,
    super.key,
  });

  final VoidCallback? onPressed;
  final bool isLoading;

  @override
  Widget build(BuildContext context) {
    final brightness = Theme.of(context).brightness;
    return SizedBox(
      width: double.infinity,
      height: 48,
      child: OutlinedButton(
        onPressed: isLoading ? null : onPressed,
        style: OutlinedButton.styleFrom(
          foregroundColor: AccountFlowPalette.ink(brightness),
          side: BorderSide(color: AccountFlowPalette.line(brightness)),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(Radii.field),
          ),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            if (isLoading)
              const SizedBox.square(
                dimension: 18,
                child: CircularProgressIndicator.adaptive(strokeWidth: 2),
              )
            else
              ExcludeSemantics(
                child: SvgPicture.string(_googleMark, width: 18, height: 18),
              ),
            const SizedBox(width: Grid.xs),
            const Text('Continue with Google'),
          ],
        ),
      ),
    );
  }
}

/// Quiet separator between the provider action and email fields.
class AccountOrDivider extends StatelessWidget {
  const AccountOrDivider({super.key});

  @override
  Widget build(BuildContext context) {
    final brightness = Theme.of(context).brightness;
    return Padding(
      padding: const EdgeInsets.only(top: 19, bottom: 21),
      child: Row(
        children: [
          Expanded(child: Divider(color: AccountFlowPalette.line(brightness))),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: Grid.xs),
            child: Text(
              'or use email',
              style: context.textTheme.labelSmall?.copyWith(
                fontSize: 10,
                color: AccountFlowPalette.muted(brightness),
              ),
            ),
          ),
          Expanded(child: Divider(color: AccountFlowPalette.line(brightness))),
        ],
      ),
    );
  }
}

/// Inline status panel matching account-code error and success states.
class AccountNotice extends StatelessWidget {
  const AccountNotice({
    required this.title,
    required this.message,
    this.isError = false,
    super.key,
  });

  final String title;
  final String message;
  final bool isError;

  @override
  Widget build(BuildContext context) {
    final background = isError
        ? context.colors.errorContainer
        : context.colors.surfaceContainerHighest;
    final foreground = isError
        ? context.colors.onErrorContainer
        : context.colors.onSurface;
    return Semantics(
      liveRegion: true,
      label: '$title. $message',
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.all(Grid.twelve),
        decoration: BoxDecoration(
          color: background,
          borderRadius: BorderRadius.circular(Radii.compactCard),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              title,
              style: context.textTheme.bodyMedium?.copyWith(
                color: foreground,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: Grid.xxs),
            Text(
              message,
              style: context.textTheme.bodySmall?.copyWith(color: foreground),
            ),
          ],
        ),
      ),
    );
  }
}

/// Full-width secondary account action with the frozen screen's button height.
class AccountSecondaryButton extends StatelessWidget {
  const AccountSecondaryButton({
    required this.label,
    required this.onPressed,
    super.key,
  });

  final String label;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) => SizedBox(
    width: double.infinity,
    height: 44,
    child: TextButton(
      style: TextButton.styleFrom(
        padding: EdgeInsets.zero,
        minimumSize: const Size.fromHeight(44),
        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
      ),
      onPressed: onPressed,
      child: Text(label, textAlign: TextAlign.center),
    ),
  );
}

const _colonyMark = '''
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">
  <defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#aa87ee"/><stop offset=".5" stop-color="#895af6"/><stop offset="1" stop-color="#729be0"/></linearGradient></defs>
  <rect width="400" height="400" rx="92" fill="url(#bg)"/>
  <g transform="translate(46 90) scale(.661)" fill="none" stroke="#fff" stroke-width="14" stroke-linecap="round">
    <path d="M198 201Q176 230 163 265 M229 211Q226 243 232 274 M259 190Q281 221 296 252 M327 114Q340 82 371 74 M343 126Q367 106 395 105"/>
  </g>
  <g transform="translate(46 90) scale(.661)" fill="#fff"><circle cx="104" cy="172" r="80"/><circle cx="226" cy="164" r="52"/><circle cx="313" cy="148" r="46"/></g>
</svg>''';

const _googleMark = '''
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
  <path d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.5 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.3 13.7 17.7 9.5 24 9.5Z" fill="#EA4335"/>
  <path d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6C44.4 38.04 46.98 31.9 46.98 24.55Z" fill="#4285F4"/>
  <path d="M10.5 28.7a14.4 14.4 0 0 1 0-9.4l-7.9-6.1a24 24 0 0 0 0 21.6l7.9-6.1Z" fill="#FBBC05"/>
  <path d="M24 48c6.5 0 11.8-2.14 15.72-5.8l-7.73-6c-2.14 1.44-4.85 2.3-7.99 2.3-6.3 0-11.65-4.25-13.5-9.95l-7.9 6.1C6.5 42.57 14.6 48 24 48Z" fill="#34A853"/>
</svg>''';
