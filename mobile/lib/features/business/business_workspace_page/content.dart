part of '../business_workspace_page.dart';

class _BusinessHome extends StatelessWidget {
  const _BusinessHome({
    required this.communityName,
    required this.onProposals,
    required this.onServices,
    required this.onInvoices,
    required this.onFollowUps,
    required this.onSocial,
    required this.onWebsite,
  });

  final String? communityName;
  final VoidCallback onProposals;
  final VoidCallback onServices;
  final VoidCallback onInvoices;
  final VoidCallback? onFollowUps;
  final VoidCallback onSocial;
  final VoidCallback onWebsite;

  @override
  Widget build(BuildContext context) => ListView(
    padding: const EdgeInsets.fromLTRB(20, 18, 20, 24),
    children: [
      _BusinessHero(
        eyebrow: communityName?.trim().toUpperCase(),
        title: 'The business\nbehind the work.',
        subtitle: 'Clients, services and money, together.',
        apricot: true,
      ),
      const SizedBox(height: 16),
      Row(
        children: [
          Expanded(
            child: _BusinessHomeCard(
              icon: '↗',
              title: 'Proposals',
              subtitle: 'Scope & agreements',
              onTap: onProposals,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: _BusinessHomeCard(
              icon: '✧',
              title: 'Services',
              subtitle: 'What you offer',
              onTap: onServices,
            ),
          ),
        ],
      ),
      const SizedBox(height: 12),
      Row(
        children: [
          Expanded(
            child: _BusinessHomeCard(
              icon: 'R',
              title: 'Invoices',
              subtitle: 'Draft & issue',
              onTap: onInvoices,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: _BusinessHomeCard(
              icon: '↶',
              title: 'Follow-ups',
              subtitle: 'Keep in touch',
              onTap: onFollowUps,
              unavailableLabel:
                  'Follow-ups are unavailable until proposal follow-up drafts are supported.',
            ),
          ),
        ],
      ),
      const SizedBox(height: 16),
      _BusinessLaterRow(
        icon: '↗',
        title: 'Social',
        subtitle: 'Publishing is coming later',
        onTap: onSocial,
      ),
      const SizedBox(height: 12),
      _BusinessLaterRow(
        icon: '◇',
        title: 'Website',
        subtitle: 'Publishing is coming later',
        onTap: onWebsite,
      ),
    ],
  );
}

class _BusinessProposalList extends StatelessWidget {
  const _BusinessProposalList({
    required this.records,
    required this.onOpenProposal,
  });

  final MobileDiscoveryRecords records;
  final ValueChanged<MobileBusinessRecord> onOpenProposal;

  @override
  Widget build(BuildContext context) {
    final proposals = [...records.proposals]
      ..sort(
        (left, right) => right.event.createdAt.compareTo(left.event.createdAt),
      );
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 18, 20, 24),
      children: [
        _BusinessHero(
          eyebrow: 'PROPOSALS',
          title: proposals.isEmpty
              ? 'Room for your next offer.'
              : 'The next good\nworking relationship.',
          subtitle: proposals.isEmpty ? 'Nothing has been added yet.' : null,
        ),
        if (proposals.isEmpty) ...[
          const SizedBox(height: 16),
          const _StartOnDesktop(
            title: 'Start on desktop',
            body:
                'Create your first offer on desktop. It will be available to review here.',
          ),
        ] else ...[
          const SizedBox(height: 16),
          for (final proposal in proposals)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: _ProposalRecordCard(
                record: proposal,
                records: records,
                onTap: () => onOpenProposal(proposal),
              ),
            ),
        ],
      ],
    );
  }
}

class _ProposalRecordCard extends StatelessWidget {
  const _ProposalRecordCard({
    required this.record,
    required this.records,
    required this.onTap,
  });

  final MobileBusinessRecord record;
  final MobileDiscoveryRecords records;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final version = _proposalVersion(record, records);
    final name = _proposalClientName(version, records);
    final lines = _businessObjectList(version?.value['lines']);
    final description = lines
        .map((line) => line['description'])
        .whereType<String>()
        .firstOrNull;
    final status = switch (record.stringValue('status')) {
      'draft' => 'Draft',
      'in_review' => 'In review',
      _ => null,
    };
    final subtitle = [
      description,
      status,
    ].whereType<String>().where((value) => value.isNotEmpty).join(' · ');
    final tokens = context.mobileTokens;
    return Semantics(
      button: true,
      label: [
        name,
        if (description?.isNotEmpty == true) description!,
        ?status,
      ].join('. '),
      onTap: onTap,
      child: ExcludeSemantics(
        child: Material(
          color: tokens.paper,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(18),
            side: BorderSide(color: tokens.line),
          ),
          child: InkWell(
            onTap: onTap,
            borderRadius: BorderRadius.circular(18),
            child: Padding(
              padding: const EdgeInsets.all(13),
              child: Row(
                children: [
                  _BusinessInitialBadge(name: name),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          name,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: context.textTheme.bodyMedium?.copyWith(
                            color: tokens.ink,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        if (subtitle.isNotEmpty) ...[
                          const SizedBox(height: 3),
                          Text(
                            subtitle,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: context.textTheme.bodySmall?.copyWith(
                              color: tokens.muted,
                            ),
                          ),
                        ],
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

class _BusinessProposalDetail extends StatelessWidget {
  const _BusinessProposalDetail({
    required this.records,
    required this.eventId,
    required this.onDraftFollowUp,
    required this.onReviewAdjustment,
  });

  final _BusinessRecords records;
  final String eventId;
  final VoidCallback? onDraftFollowUp;
  final ValueChanged<MobileBusinessRecord> onReviewAdjustment;

  @override
  Widget build(BuildContext context) {
    final proposal = records.discovery.proposals
        .where((record) => record.event.id == eventId)
        .firstOrNull;
    if (proposal == null) return const _BusinessUnavailable();
    final version = _proposalVersion(proposal, records.discovery);
    if (version == null) return const _BusinessUnavailable();
    final lines = _businessObjectList(version.value['lines']);
    final title = _proposalClientName(version, records.discovery);
    final serviceName = _proposalServiceName(version, records.discovery);
    final leadLine = lines
        .map((line) => line['description'])
        .whereType<String>()
        .firstOrNull;
    final linkedInvoice = _issuedInvoiceForProposal(proposal, records.money);
    final currency = version.stringValue('currency') ?? '';
    final total = _businessProposalTotal(lines);
    final terms = version.stringValue('terms');
    final tokens = context.mobileTokens;
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 18, 20, 24),
      children: [
        _BusinessHero(
          eyebrow: 'DRAFT PROPOSAL',
          title: title,
          subtitle: leadLine,
          apricot: true,
        ),
        if (serviceName != null)
          _BusinessDetailRow(label: 'Service', value: serviceName),
        if (currency.trim().isNotEmpty && lines.isNotEmpty)
          _BusinessDetailRow(
            label: 'Fee',
            value: _businessMoney(total, currency),
          ),
        const SizedBox(height: 12),
        _BusinessSurface(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'What is included',
                style: context.textTheme.titleSmall?.copyWith(
                  color: tokens.ink,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 10),
              for (final line in lines) _BusinessProposalBullet(line: line),
              if (terms?.trim().isNotEmpty == true) ...[
                const SizedBox(height: 8),
                Text(
                  terms!,
                  style: context.textTheme.bodyMedium?.copyWith(
                    color: tokens.ink,
                    height: 1.45,
                  ),
                ),
              ],
            ],
          ),
        ),
        const SizedBox(height: 12),
        _BusinessActionButton(
          label: 'Draft a follow-up',
          onPressed: onDraftFollowUp,
          semanticUnavailableReason:
              'Proposal follow-up drafts are unavailable on mobile.',
        ),
        const SizedBox(height: 10),
        _BusinessActionButton(
          label: 'Review an adjustment',
          onPressed: linkedInvoice == null
              ? null
              : () => onReviewAdjustment(linkedInvoice),
          secondary: true,
          semanticUnavailableReason:
              'An issued invoice linked to this proposal is required.',
        ),
        const SizedBox(height: 10),
        const _BusinessActionButton(
          label: 'Create an invoice',
          onPressed: null,
          secondary: true,
          semanticUnavailableReason:
              'Mobile proposal acceptance is not available.',
        ),
      ],
    );
  }
}

class _BusinessProposalBullet extends StatelessWidget {
  const _BusinessProposalBullet({required this.line});

  final Map<String, Object?> line;

  @override
  Widget build(BuildContext context) {
    final description = line['description'] is String
        ? line['description'] as String
        : '';
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Text(
        '• $description',
        style: context.textTheme.bodyMedium?.copyWith(
          color: context.mobileTokens.ink,
          height: 1.45,
        ),
      ),
    );
  }
}

class _BusinessServiceList extends StatelessWidget {
  const _BusinessServiceList({
    required this.records,
    required this.onOpenService,
  });

  final MobileDiscoveryRecords records;
  final ValueChanged<MobileBusinessRecord> onOpenService;

  @override
  Widget build(BuildContext context) {
    final services = [...records.services]
      ..sort(
        (left, right) => right.event.createdAt.compareTo(left.event.createdAt),
      );
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 18, 20, 24),
      children: [
        _BusinessHero(
          eyebrow: services.isEmpty ? 'SERVICES' : 'YOUR SERVICES',
          title: services.isEmpty
              ? 'Room for your next offer.'
              : 'Make the offer clear.',
          subtitle: services.isEmpty ? 'Nothing has been added yet.' : null,
        ),
        if (services.isEmpty) ...[
          const SizedBox(height: 16),
          const _StartOnDesktop(
            title: 'Start on desktop',
            body:
                'Create your first service on desktop. It will be available to review here.',
          ),
        ] else ...[
          const SizedBox(height: 16),
          for (final service in services)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: _ServiceRecordCard(
                record: service,
                onTap: () => onOpenService(service),
              ),
            ),
        ],
      ],
    );
  }
}

class _ServiceRecordCard extends StatelessWidget {
  const _ServiceRecordCard({required this.record, required this.onTap});

  final MobileBusinessRecord record;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final service = record.objectValue('service') ?? const {};
    final name = _businessStringField(service, 'name', 'Service');
    final description = service['description'];
    final tokens = context.mobileTokens;
    return Semantics(
      button: true,
      label: [
        name,
        if (description is String && description.trim().isNotEmpty)
          description.trim(),
      ].join('. '),
      onTap: onTap,
      child: ExcludeSemantics(
        child: Material(
          color: tokens.paper,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(18),
            side: BorderSide(color: tokens.line),
          ),
          child: InkWell(
            onTap: onTap,
            borderRadius: BorderRadius.circular(18),
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Row(
                children: [
                  Container(
                    width: 38,
                    height: 40,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: tokens.soft,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: _businessSymbol(context, '✧', size: 18),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          name,
                          style: context.textTheme.bodyMedium?.copyWith(
                            color: tokens.ink,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        if (description is String &&
                            description.trim().isNotEmpty) ...[
                          const SizedBox(height: 4),
                          Text(
                            description.trim(),
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: context.textTheme.bodySmall?.copyWith(
                              color: tokens.muted,
                            ),
                          ),
                        ],
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

class _BusinessServiceDetail extends StatelessWidget {
  const _BusinessServiceDetail({
    required this.records,
    required this.eventId,
    required this.onOpenProposal,
  });

  final MobileDiscoveryRecords records;
  final String eventId;
  final ValueChanged<MobileBusinessRecord> onOpenProposal;

  @override
  Widget build(BuildContext context) {
    final record = records.services
        .where((candidate) => candidate.event.id == eventId)
        .firstOrNull;
    if (record == null) return const _BusinessUnavailable();
    final service = record.objectValue('service') ?? const {};
    final name = _businessStringField(service, 'name', 'Service');
    final description = service['description'];
    final fee = service['monthlyFeeMinor'];
    final currency = service['currency'];
    final serviceId = record.stringValue('serviceId');
    final linkedProposal = records.proposals.where((proposal) {
      final version = _proposalVersion(proposal, records);
      final lines = _businessObjectList(version?.value['lines']);
      return serviceId != null &&
          lines.any((line) => line['serviceId'] == serviceId);
    }).firstOrNull;
    final tokens = context.mobileTokens;
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 18, 20, 24),
      children: [
        _BusinessHero(
          eyebrow: 'SERVICE',
          title: name,
          subtitle: 'A repeatable offer with room for each client.',
        ),
        if (description is String && description.trim().isNotEmpty) ...[
          const SizedBox(height: 16),
          _BusinessSurface(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Delivery scope',
                  style: context.textTheme.titleSmall?.copyWith(
                    color: tokens.ink,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  description.trim(),
                  style: context.textTheme.bodyMedium?.copyWith(
                    color: tokens.ink,
                    height: 1.45,
                  ),
                ),
              ],
            ),
          ),
        ],
        if (fee is int && currency is String)
          _BusinessDetailRow(
            label: 'Pricing',
            value: _businessMoney(fee, currency),
          ),
        if (linkedProposal != null) ...[
          const SizedBox(height: 14),
          _BusinessActionButton(
            label: 'View client proposal',
            onPressed: () => onOpenProposal(linkedProposal),
          ),
        ],
      ],
    );
  }
}

class _BusinessComingLater extends StatelessWidget {
  const _BusinessComingLater({
    required this.eyebrow,
    required this.headline,
    required this.subhead,
    required this.progressTitle,
    required this.progressBody,
    this.assuranceTitle,
    this.assuranceBody,
    this.onOpenChat,
    this.rose = false,
  });

  final String eyebrow;
  final String headline;
  final String subhead;
  final String progressTitle;
  final String progressBody;
  final String? assuranceTitle;
  final String? assuranceBody;
  final VoidCallback? onOpenChat;
  final bool rose;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 18, 20, 24),
      children: [
        _BusinessHero(
          eyebrow: eyebrow,
          title: headline,
          subtitle: subhead,
          rose: rose,
        ),
        const SizedBox(height: 16),
        _BusinessSurface(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                progressTitle,
                style: context.textTheme.titleSmall?.copyWith(
                  color: tokens.ink,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                progressBody,
                style: context.textTheme.bodyMedium?.copyWith(
                  color: tokens.ink,
                  height: 1.45,
                ),
              ),
            ],
          ),
        ),
        if (onOpenChat != null) ...[
          const SizedBox(height: 10),
          _BusinessActionButton(
            label: 'Open conversations',
            onPressed: onOpenChat,
          ),
        ],
        if (assuranceTitle != null && assuranceBody != null) ...[
          const SizedBox(height: 12),
          _BusinessNotice(title: assuranceTitle!, body: assuranceBody!),
        ],
      ],
    );
  }
}

class _BusinessInvoiceEmpty extends StatelessWidget {
  const _BusinessInvoiceEmpty();

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 18, 20, 24),
      children: [
        const _BusinessHero(
          eyebrow: 'MONEY',
          title: 'Start with your\nfirst invoice.',
          subtitle: 'Draft it, check the details, then issue when ready.',
          apricot: true,
        ),
        const SizedBox(height: 16),
        _BusinessSurface(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'No invoices yet',
                style: context.textTheme.titleSmall?.copyWith(
                  color: tokens.ink,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                'Your invoices will appear here with their client, due date and payment status.',
                style: context.textTheme.bodyMedium?.copyWith(
                  color: tokens.ink,
                  height: 1.45,
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 10),
        const _BusinessActionButton(
          label: 'New invoice',
          onPressed: null,
          semanticUnavailableReason:
              'New invoices require mobile proposal acceptance.',
        ),
      ],
    );
  }
}

class _BusinessIssuedInvoiceDetail extends StatelessWidget {
  const _BusinessIssuedInvoiceDetail({
    required this.invoice,
    required this.clientName,
    required this.workspaceName,
    required this.lines,
    required this.taxLines,
    required this.onBack,
  });

  final MobileBusinessRecord invoice;
  final String clientName;
  final String? workspaceName;
  final List<Map<String, Object?>> lines;
  final List<Map<String, Object?>> taxLines;
  final VoidCallback onBack;

  @override
  Widget build(BuildContext context) {
    final currency = invoice.stringValue('currency')!;
    final total = invoice.integerValue('totalMinor')!;
    final subtotal = _businessInvoiceSubtotal(lines);
    final tax = _businessInvoiceTaxTotal(lines, taxLines);
    final tokens = context.mobileTokens;
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 28),
      children: [
        const _BusinessHero(
          eyebrow: 'ISSUED INVOICE',
          title: 'Invoice detail',
          subtitle: 'Review the amount and the client.',
          apricot: true,
        ),
        const SizedBox(height: 16),
        _BusinessSurface(
          child: Padding(
            padding: const EdgeInsets.all(3),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  workspaceName!.trim(),
                  style: context.textTheme.titleSmall?.copyWith(
                    color: tokens.ink,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 4),
                _BusinessDetailRow(label: 'Bill to', value: clientName),
                for (final line in lines)
                  _BusinessIssuedInvoiceLine(line: line, currency: currency),
                const SizedBox(height: 4),
                _BusinessDetailRow(
                  label: 'Subtotal',
                  value: _businessInvoiceMoney(subtotal, currency),
                ),
                _BusinessDetailRow(
                  label: 'Tax',
                  value: _businessInvoiceMoney(tax, currency),
                ),
                _BusinessIssuedInvoiceTotal(
                  value: _businessInvoiceMoney(total, currency),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 16),
        _BusinessActionButton(
          label: 'Back to invoices',
          onPressed: onBack,
          soft: true,
        ),
        const SizedBox(height: 16),
        const _BusinessNotice(
          title: 'Issue does not mean send',
          body:
              'This records the invoice. It sends no email and collects no payment.',
          accentColor: Color(0xFFA893C8),
        ),
      ],
    );
  }
}

class _BusinessIssuedInvoiceLine extends StatelessWidget {
  const _BusinessIssuedInvoiceLine({
    required this.line,
    required this.currency,
  });

  final Map<String, Object?> line;
  final String currency;

  @override
  Widget build(BuildContext context) {
    final quantity = line['quantityHundredths'] as int;
    final unitAmount = line['unitAmountMinor'] as int;
    final amount = _businessInvoiceLineAmount(line);
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 14),
      decoration: BoxDecoration(
        border: Border(bottom: BorderSide(color: context.mobileTokens.line)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  line['description'] as String,
                  style: context.textTheme.bodySmall?.copyWith(
                    color: context.mobileTokens.ink,
                  ),
                ),
                const SizedBox(height: 5),
                Text(
                  '${NumberFormat('0.##').format(quantity / 100)} × '
                  '${_businessInvoiceMoney(unitAmount, currency)}',
                  style: context.textTheme.labelSmall?.copyWith(
                    color: context.mobileTokens.muted,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 12),
          Text(
            _businessInvoiceMoney(amount, currency),
            textAlign: TextAlign.end,
            style: context.textTheme.bodySmall?.copyWith(
              color: context.mobileTokens.ink,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}

class _BusinessIssuedInvoiceTotal extends StatelessWidget {
  const _BusinessIssuedInvoiceTotal({required this.value});

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
          child: Text(
            'Total',
            style: context.textTheme.bodySmall?.copyWith(
              color: context.mobileTokens.muted,
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
        Text(
          value,
          style: context.textTheme.bodySmall?.copyWith(
            color: context.mobileTokens.ink,
            fontWeight: FontWeight.w700,
          ),
        ),
      ],
    ),
  );
}

List<Map<String, Object?>> _businessInvoiceLines(MobileBusinessRecord invoice) {
  final lines = invoice.value['lines'];
  if (lines is! List) return const [];
  return [
    for (final line in lines)
      if (line is Map) line.map((key, value) => MapEntry(key as String, value)),
  ];
}

List<Map<String, Object?>>? _businessInvoiceTaxLines(
  MobileBusinessRecord invoice,
) {
  final taxLines = invoice.value['taxLines'];
  if (taxLines == null) return const [];
  if (taxLines is! List) return null;
  final parsed = <Map<String, Object?>>[];
  for (final line in taxLines) {
    if (line is! Map || line['rateBasisPoints'] is! int) return null;
    parsed.add(line.map((key, value) => MapEntry(key as String, value)));
  }
  return parsed;
}

int _businessInvoiceLineAmount(Map<String, Object?> line) {
  final quantity = line['quantityHundredths'] as int;
  final unitAmount = line['unitAmountMinor'] as int;
  return (BigInt.from(quantity) * BigInt.from(unitAmount) ~/ BigInt.from(100))
      .toInt();
}

int _businessInvoiceSubtotal(List<Map<String, Object?>> lines) =>
    lines.fold(0, (total, line) => total + _businessInvoiceLineAmount(line));

int _businessInvoiceTaxTotal(
  List<Map<String, Object?>> lines,
  List<Map<String, Object?>> taxLines,
) {
  var total = BigInt.zero;
  for (final line in lines) {
    final lineAmount = BigInt.from(_businessInvoiceLineAmount(line));
    for (final tax in taxLines) {
      final rate = tax['rateBasisPoints'] as int;
      total +=
          (lineAmount * BigInt.from(rate) + BigInt.from(5000)) ~/
          BigInt.from(10000);
    }
  }
  return total.toInt();
}

String _businessInvoiceMoney(int amountMinor, String currency) {
  final decimalDigits =
      NumberFormat.simpleCurrency(name: currency).decimalDigits ?? 2;
  final pattern = decimalDigits == 0
      ? '0'
      : '0.${List.filled(decimalDigits, '0').join()}';
  final amount = amountMinor / math.pow(10, decimalDigits);
  return '$currency ${NumberFormat(pattern).format(amount)}';
}

String _proposalClientName(
  MobileBusinessRecord? version,
  MobileDiscoveryRecords records,
) {
  final partyId = version?.stringValue('prospectPartyId');
  if (partyId == null) return 'Proposal';
  for (final prospectRecord in records.prospects) {
    final prospect = prospectRecord.objectValue('prospect') ?? const {};
    final party = _businessObjectMap(prospect['party']);
    if (party?['partyId'] == partyId) {
      return _businessStringField(party!, 'displayName', 'Proposal');
    }
  }
  return 'Proposal';
}

String? _proposalServiceName(
  MobileBusinessRecord? version,
  MobileDiscoveryRecords records,
) {
  final lines = _businessObjectList(version?.value['lines']);
  final serviceId = lines
      .map((line) => line['serviceId'])
      .whereType<String>()
      .firstOrNull;
  if (serviceId == null) return null;
  for (final record in records.services) {
    if (record.stringValue('serviceId') != serviceId) continue;
    final service = record.objectValue('service') ?? const {};
    final name = service['name'];
    if (name is String && name.trim().isNotEmpty) return name.trim();
  }
  return null;
}

MobileBusinessRecord? _issuedInvoiceForProposal(
  MobileBusinessRecord proposal,
  MobileMoneyRecords money,
) {
  final proposalId = proposal.stringValue('proposalId');
  if (proposalId == null) return null;
  return money.invoiceHeads
      .where(
        (invoice) =>
            invoice.stringValue('proposalId') == proposalId &&
            invoice.stringValue('status') == 'issued',
      )
      .firstOrNull;
}
