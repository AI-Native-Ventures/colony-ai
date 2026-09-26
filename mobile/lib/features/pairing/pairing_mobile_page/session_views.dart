part of '../pairing_mobile_page.dart';

class _PairingCompareView extends StatelessWidget {
  const _PairingCompareView({required this.pairing});

  final PairingState pairing;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return _PairingContent(
      children: [
        const _PairingIntro(
          title: 'Do the codes match?',
          description:
              'Check this exact number on your desktop before approving.',
        ),
        const SizedBox(height: 26),
        _PairingCodeCard(code: pairing.sasCode ?? ''),
        const SizedBox(height: 26),
        const _PairingDesktopRow(subtitle: 'Existing Colony identity'),
        const SizedBox(height: 24),
        Text(
          'Confirm only if you started this pairing. Your Colony identity will be available on this phone.',
          style: context.mobileTypography.conversation.copyWith(
            color: tokens.muted,
            fontSize: 12,
            height: 1.65,
          ),
        ),
      ],
    );
  }
}

class _PairingWaitingView extends StatelessWidget {
  const _PairingWaitingView({required this.pairing});

  final PairingState pairing;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return _PairingContent(
      children: [
        const _PairingIntro(
          title: 'Confirm on your desktop.',
          description: 'You’ve approved on this phone. Keep both devices open.',
        ),
        const SizedBox(height: 26),
        _PairingCodeCard(code: pairing.sasCode ?? ''),
        const SizedBox(height: 24),
        const _PairingDesktopRow(subtitle: 'Existing Colony identity'),
        const SizedBox(height: 40),
        Row(
          children: [
            Container(
              width: 8,
              height: 8,
              decoration: BoxDecoration(
                color: _pairingWaitingColor,
                shape: BoxShape.circle,
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                'Waiting for desktop approval',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: context.mobileTypography.conversation.copyWith(
                  color: tokens.muted,
                  fontSize: 12,
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 36),
        Text(
          'On your desktop, compare the code and choose “Confirm pairing”.',
          style: context.mobileTypography.conversation.copyWith(
            color: tokens.muted,
            fontSize: 12,
            height: 1.65,
          ),
        ),
      ],
    );
  }
}

class _PairingCodeCard extends StatelessWidget {
  const _PairingCodeCard({required this.code});

  final String code;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return Container(
      height: 100,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: tokens.soft,
        borderRadius: BorderRadius.circular(Radii.container),
      ),
      child: Semantics(
        label: 'Confirmation code $code',
        child: ExcludeSemantics(
          child: Text(
            code,
            style: context.mobileTypography.flowTitle.copyWith(
              color: tokens.ink,
              fontSize: 32,
              fontWeight: FontWeight.w700,
              letterSpacing: 3.84,
              height: 1.15,
            ),
          ),
        ),
      ),
    );
  }
}

class _PairingDesktopRow extends StatelessWidget {
  const _PairingDesktopRow({required this.subtitle});

  final String subtitle;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 18),
      decoration: BoxDecoration(
        border: Border.symmetric(horizontal: BorderSide(color: tokens.line)),
      ),
      child: Row(
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              color: const Color(0x20a688bb),
              borderRadius: BorderRadius.circular(10),
            ),
            alignment: Alignment.center,
            child: ExcludeSemantics(
              child: CustomPaint(
                size: const Size(23, 16),
                painter: _PairingLaptopGlyph(tokens.ink),
              ),
            ),
          ),
          const SizedBox(width: 13),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Desktop',
                  style: context.mobileTypography.conversation.copyWith(
                    color: tokens.ink,
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 5),
                Text(
                  subtitle,
                  style: context.mobileTypography.metadata.copyWith(
                    color: tokens.muted,
                    fontSize: 11,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
