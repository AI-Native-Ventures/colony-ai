part of '../business_workspace_page.dart';

const _businessHeroStandardLight = LinearGradient(
  begin: Alignment.topLeft,
  end: Alignment.bottomRight,
  colors: [Color(0xFFECE5FF), Color(0xFFF3E8EC), Color(0xFFFFE9D7)],
  stops: [0, 0.7, 1],
);

const _businessHeroStandardDark = LinearGradient(
  begin: Alignment.topLeft,
  end: Alignment.bottomRight,
  colors: [Color(0xFF41334F), Color(0xFF503A48), Color(0xFF59493E)],
  stops: [0, 0.7, 1],
);

const _businessHeroApricotLight = LinearGradient(
  begin: Alignment.topLeft,
  end: Alignment.bottomRight,
  colors: [Color(0xFFF9E4CA), Color(0xFFFAEBEE), Color(0xFFEEE4FF)],
  stops: [0, 0.62, 1],
);

const _businessHeroApricotDark = LinearGradient(
  begin: Alignment.topLeft,
  end: Alignment.bottomRight,
  colors: [Color(0xFF5E4234), Color(0xFF503847), Color(0xFF3D324A)],
  stops: [0, 0.6, 1],
);

const _businessHeroRoseLight = LinearGradient(
  begin: Alignment.topLeft,
  end: Alignment.bottomRight,
  colors: [Color(0xFFF5DCE7), Color(0xFFF3E7F9)],
);

Gradient _businessHeroGradient(
  BuildContext context, {
  required bool apricot,
  required bool rose,
}) {
  final dark = Theme.of(context).brightness == Brightness.dark;
  if (apricot) {
    return dark ? _businessHeroApricotDark : _businessHeroApricotLight;
  }
  if (rose && !dark) return _businessHeroRoseLight;
  return dark ? _businessHeroStandardDark : _businessHeroStandardLight;
}

Widget _businessSymbol(
  BuildContext context,
  String symbol, {
  required double size,
}) {
  final tokens = context.mobileTokens;
  final icon = switch (symbol) {
    '↗' => Icons.north_east,
    '✧' => Icons.auto_awesome_outlined,
    '↶' || '↩' => Icons.reply,
    '◇' => Icons.diamond_outlined,
    _ => null,
  };
  if (icon != null) return Icon(icon, size: size, color: tokens.action);
  return Text(
    symbol,
    style: context.textTheme.titleLarge?.copyWith(
      color: tokens.action,
      fontWeight: FontWeight.w400,
    ),
  );
}

class _BusinessHero extends StatelessWidget {
  const _BusinessHero({
    required this.eyebrow,
    required this.title,
    this.subtitle,
    this.apricot = false,
    this.rose = false,
  });

  final String? eyebrow;
  final String title;
  final String? subtitle;
  final bool apricot;
  final bool rose;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return Container(
      decoration: BoxDecoration(
        gradient: _businessHeroGradient(context, apricot: apricot, rose: rose),
        borderRadius: BorderRadius.circular(23),
      ),
      padding: const EdgeInsets.fromLTRB(22, 23, 22, 23),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (eyebrow?.isNotEmpty == true) ...[
            Text(
              eyebrow!,
              style: context.mobileTypography.companySection.copyWith(
                color: tokens.action,
              ),
            ),
            const SizedBox(height: 13),
          ],
          Text(
            title,
            style: context.textTheme.headlineMedium?.copyWith(
              color: tokens.ink,
              fontWeight: FontWeight.w800,
              height: 1.16,
              letterSpacing: -1,
            ),
          ),
          if (subtitle?.isNotEmpty == true) ...[
            const SizedBox(height: 9),
            Text(
              subtitle!,
              style: context.textTheme.bodyMedium?.copyWith(
                color: tokens.ink,
                height: 1.6,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _BusinessHomeCard extends StatelessWidget {
  const _BusinessHomeCard({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
    this.unavailableLabel,
  });

  final String icon;
  final String title;
  final String subtitle;
  final VoidCallback? onTap;
  final String? unavailableLabel;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return Semantics(
      button: true,
      enabled: onTap != null,
      label: onTap == null ? unavailableLabel ?? title : '$title. $subtitle',
      onTap: onTap,
      child: ExcludeSemantics(
        child: Material(
          color: tokens.paper,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(22),
            side: BorderSide(color: tokens.line),
          ),
          child: InkWell(
            onTap: onTap,
            borderRadius: BorderRadius.circular(22),
            child: SizedBox(
              height: 134,
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _businessSymbol(context, icon, size: 22),
                    const Spacer(),
                    Text(
                      title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: context.textTheme.titleSmall?.copyWith(
                        color: tokens.ink,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      subtitle,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: context.textTheme.bodySmall?.copyWith(
                        color: tokens.muted,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _BusinessLaterRow extends StatelessWidget {
  const _BusinessLaterRow({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });

  final String icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return Semantics(
      button: true,
      label: '$title. $subtitle',
      onTap: onTap,
      child: ExcludeSemantics(
        child: Material(
          color: tokens.paper,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(17),
            side: BorderSide(color: tokens.line),
          ),
          child: InkWell(
            onTap: onTap,
            borderRadius: BorderRadius.circular(17),
            child: Padding(
              padding: const EdgeInsets.all(13),
              child: Row(
                children: [
                  Container(
                    width: 38,
                    height: 38,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: tokens.soft,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: _businessSymbol(context, icon, size: 20),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          title,
                          style: context.textTheme.bodyMedium?.copyWith(
                            color: tokens.ink,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        Text(
                          subtitle,
                          style: context.textTheme.bodySmall?.copyWith(
                            color: tokens.muted,
                          ),
                        ),
                      ],
                    ),
                  ),
                  Icon(Icons.chevron_right, color: tokens.muted, size: 20),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _StartOnDesktop extends StatelessWidget {
  const _StartOnDesktop({required this.title, required this.body});

  final String title;
  final String body;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 14),
      decoration: BoxDecoration(
        color: tokens.paper,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: tokens.line),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 3,
            height: 61,
            decoration: BoxDecoration(
              color: tokens.action,
              borderRadius: BorderRadius.circular(2),
            ),
          ),
          const SizedBox(width: 13),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: context.textTheme.bodyMedium?.copyWith(
                    color: tokens.ink,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  body,
                  style: context.textTheme.bodySmall?.copyWith(
                    color: tokens.ink,
                    height: 1.45,
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

class _BusinessSurface extends StatelessWidget {
  const _BusinessSurface({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(16),
    decoration: BoxDecoration(
      color: context.mobileTokens.paper,
      borderRadius: BorderRadius.circular(20),
      border: Border.all(color: context.mobileTokens.line),
    ),
    child: child,
  );
}

class _BusinessNotice extends StatelessWidget {
  const _BusinessNotice({
    required this.title,
    required this.body,
    this.accentColor,
  });

  final String title;
  final String body;
  final Color? accentColor;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 14),
      decoration: BoxDecoration(
        color: tokens.paper,
        borderRadius: BorderRadius.circular(16),
        border: Border(
          left: BorderSide(color: accentColor ?? tokens.action, width: 3),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: context.textTheme.bodyMedium?.copyWith(
              color: tokens.ink,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            body,
            style: context.textTheme.bodySmall?.copyWith(
              color: tokens.ink,
              height: 1.6,
            ),
          ),
        ],
      ),
    );
  }
}

class _BusinessDetailRow extends StatelessWidget {
  const _BusinessDetailRow({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(vertical: 12),
    decoration: BoxDecoration(
      border: Border(bottom: BorderSide(color: context.mobileTokens.line)),
    ),
    child: Row(
      children: [
        Expanded(
          flex: 38,
          child: Text(
            label,
            style: context.textTheme.bodySmall?.copyWith(
              color: context.mobileTokens.muted,
            ),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          flex: 62,
          child: Text(
            value,
            textAlign: TextAlign.end,
            style: context.textTheme.bodySmall?.copyWith(
              color: context.mobileTokens.ink,
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
      ],
    ),
  );
}

class _BusinessInitialBadge extends StatelessWidget {
  const _BusinessInitialBadge({required this.name});

  final String name;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return Container(
      width: 40,
      height: 40,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: tokens.soft,
        borderRadius: BorderRadius.circular(13),
      ),
      child: Text(
        (name.isEmpty ? '?' : name[0]).toUpperCase(),
        style: context.textTheme.bodyMedium?.copyWith(
          color: tokens.action,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }
}

class _BusinessActionButton extends StatelessWidget {
  const _BusinessActionButton({
    required this.label,
    required this.onPressed,
    this.secondary = false,
    this.soft = false,
    this.semanticUnavailableReason,
  });

  final String label;
  final VoidCallback? onPressed;
  final bool secondary;
  final bool soft;
  final String? semanticUnavailableReason;

  @override
  Widget build(BuildContext context) {
    final button = SizedBox(
      width: double.infinity,
      child: secondary
          ? OutlinedButton(onPressed: onPressed, child: Text(label))
          : FilledButton(
              onPressed: onPressed,
              style: soft
                  ? FilledButton.styleFrom(
                      backgroundColor: context.mobileTokens.soft,
                      foregroundColor: context.mobileTokens.action,
                    )
                  : null,
              child: Text(label),
            ),
    );
    if (onPressed != null) return button;
    return Semantics(
      button: true,
      enabled: false,
      label: semanticUnavailableReason ?? label,
      child: ExcludeSemantics(child: button),
    );
  }
}

class _BusinessLoading extends StatelessWidget {
  const _BusinessLoading();

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 18, 20, 24),
      children: [
        const _BusinessNotice(
          title: 'Loading the latest information',
          body: 'Actions will appear when this record is ready.',
        ),
        const SizedBox(height: 16),
        Container(
          height: 260,
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.centerLeft,
              end: Alignment.centerRight,
              colors: [tokens.paper, tokens.line, tokens.paper],
            ),
            borderRadius: BorderRadius.circular(20),
          ),
        ),
      ],
    );
  }
}

class _BusinessUnavailable extends StatelessWidget {
  const _BusinessUnavailable({this.onRetry});

  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) => ListView(
    padding: const EdgeInsets.fromLTRB(20, 18, 20, 24),
    children: [
      const _BusinessHero(
        eyebrow: 'CONNECTION UNAVAILABLE',
        title: 'Let’s try again.',
        subtitle: 'This is not an empty record.',
      ),
      if (onRetry != null) ...[
        const SizedBox(height: 10),
        _BusinessActionButton(label: 'Retry connection', onPressed: onRetry),
      ],
    ],
  );
}

MobileBusinessRecord? _proposalVersion(
  MobileBusinessRecord proposal,
  MobileDiscoveryRecords records,
) {
  final versionId = proposal.stringValue('currentVersionEventId');
  if (versionId == null) return null;
  return records.proposalVersions
      .where((record) => record.event.id == versionId)
      .firstOrNull;
}

List<Map<String, Object?>> _businessObjectList(Object? value) => value is List
    ? [
        for (final item in value)
          if (item is Map)
            item.map((key, value) => MapEntry(key as String, value)),
      ]
    : const [];

Map<String, Object?>? _businessObjectMap(Object? value) => value is Map
    ? value.map((key, value) => MapEntry(key as String, value))
    : null;

String _businessStringField(
  Map<String, Object?> map,
  String key,
  String fallback,
) {
  final value = map[key];
  return value is String && value.trim().isNotEmpty ? value.trim() : fallback;
}

int _businessProposalLineAmount(Map<String, Object?> line) {
  final quantity = line['quantityHundredths'];
  final unitAmount = line['unitAmountMinor'];
  if (quantity is! int || unitAmount is! int) return 0;
  return quantity * unitAmount ~/ 100;
}

int _businessProposalTotal(List<Map<String, Object?>> lines) =>
    lines.fold(0, (total, line) => total + _businessProposalLineAmount(line));

String _businessMoney(int amountMinor, String currency) {
  if (currency.trim().isEmpty) return amountMinor.toString();
  final digits = NumberFormat.simpleCurrency(name: currency).decimalDigits ?? 2;
  final value = amountMinor / math.pow(10, digits);
  return NumberFormat.currency(
    name: currency,
    symbol: '$currency ',
    decimalDigits: digits,
  ).format(value);
}
