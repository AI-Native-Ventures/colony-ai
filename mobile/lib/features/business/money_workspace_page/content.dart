part of '../money_workspace_page.dart';

enum _MoneySection { overview, revenue }

final class _MoneyTaxBackToMoney {
  const _MoneyTaxBackToMoney();
}

class _MoneyLoadError extends StatelessWidget {
  const _MoneyLoadError({required this.onRetry});

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.all(28),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            Icons.work_outline,
            size: 40,
            color: context.mobileTokens.action,
          ),
          const SizedBox(height: 18),
          Text(
            'Money could not load',
            textAlign: TextAlign.center,
            style: context.textTheme.titleLarge?.copyWith(
              color: context.mobileTokens.ink,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 12),
          Text(
            'The connected source is unavailable. Existing work is kept, and missing data is not shown as zero.',
            textAlign: TextAlign.center,
            style: context.textTheme.bodySmall?.copyWith(
              color: context.mobileTokens.muted,
              height: 1.55,
            ),
          ),
          const SizedBox(height: 20),
          SizedBox(
            width: double.infinity,
            child: FilledButton(
              onPressed: onRetry,
              child: const Text('Retry connection'),
            ),
          ),
        ],
      ),
    ),
  );
}

class _MoneyWorkspaceContent extends StatelessWidget {
  const _MoneyWorkspaceContent({
    required this.records,
    required this.section,
    required this.selectedClientId,
    required this.onSectionChanged,
    required this.onClientChanged,
    required this.onRecordChanged,
  });

  final MobileMoneyRecords records;
  final _MoneySection section;
  final String? selectedClientId;
  final ValueChanged<_MoneySection> onSectionChanged;
  final ValueChanged<String?> onClientChanged;
  final VoidCallback onRecordChanged;

  @override
  Widget build(BuildContext context) {
    final clients = records.clientHeads
        .where((record) => record.stringValue('status') != 'archived')
        .toList();
    final clientIds = clients.map((client) => client.channelId).toSet();
    final activeClient = clientIds.contains(selectedClientId)
        ? selectedClientId
        : null;
    final invoices = records.invoiceHeads.where((record) {
      if (activeClient == null) return true;
      return record.stringValue('clientId') == activeClient;
    }).toList();
    final tokens = context.mobileTokens;

    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 20, 20, 28),
      children: [
        if (section == _MoneySection.overview) ...[
          Text(
            'THE BUSINESS PICTURE',
            style: context.textTheme.labelSmall?.copyWith(
              color: tokens.action,
              fontWeight: FontWeight.w800,
              letterSpacing: 0.5,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'Revenue',
            style: context.textTheme.headlineSmall?.copyWith(
              color: tokens.ink,
              fontWeight: FontWeight.w800,
              letterSpacing: -0.6,
            ),
          ),
          const SizedBox(height: 18),
        ],
        _MoneySectionNavigation(selected: section, onChanged: onSectionChanged),
        const SizedBox(height: 31),
        Text('Client', style: context.textTheme.labelSmall),
        const SizedBox(height: 8),
        DropdownButtonFormField<String?>(
          key: ValueKey('money-client-$activeClient'),
          initialValue: activeClient,
          style: context.textTheme.bodySmall,
          decoration: InputDecoration(
            filled: true,
            fillColor: tokens.paper,
            border: OutlineInputBorder(borderRadius: BorderRadius.circular(13)),
          ),
          items: [
            const DropdownMenuItem<String?>(
              value: null,
              child: Text('All clients'),
            ),
            for (final client in clients)
              DropdownMenuItem<String?>(
                value: client.channelId,
                child: Text(_clientName(client.channelId, records)),
              ),
          ],
          onChanged: onClientChanged,
        ),
        const SizedBox(height: 16),
        if (section == _MoneySection.overview)
          _MoneyOverview(invoices: invoices)
        else if (invoices.isEmpty)
          const _MoneyEmptyState()
        else
          for (final invoice in invoices)
            _MoneyRecordTile(
              key: ValueKey(invoice.event.id),
              invoice: invoice,
              records: records,
              onRecordChanged: onRecordChanged,
            ),
      ],
    );
  }
}

class _MoneySectionNavigation extends StatelessWidget {
  const _MoneySectionNavigation({
    required this.selected,
    required this.onChanged,
  });

  final _MoneySection selected;
  final ValueChanged<_MoneySection> onChanged;

  @override
  Widget build(BuildContext context) => SingleChildScrollView(
    scrollDirection: Axis.horizontal,
    child: Row(
      children: [
        for (final section in _MoneySection.values)
          Padding(
            padding: const EdgeInsets.only(right: 8),
            child: _MoneySectionButton(
              section: section,
              selected: selected == section,
              onTap: () => onChanged(section),
            ),
          ),
      ],
    ),
  );
}

class _MoneySectionButton extends StatelessWidget {
  const _MoneySectionButton({
    required this.section,
    required this.selected,
    required this.onTap,
  });

  final _MoneySection section;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final label = section == _MoneySection.overview ? 'Overview' : 'Revenue';
    final tokens = context.mobileTokens;
    return Semantics(
      button: true,
      selected: selected,
      label: label,
      onTap: onTap,
      child: ExcludeSemantics(
        child: Material(
          color: tokens.paper,
          shape: StadiumBorder(side: BorderSide(color: tokens.line)),
          child: InkWell(
            onTap: onTap,
            customBorder: const StadiumBorder(),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 11),
              child: Text(
                label,
                style: context.textTheme.labelSmall?.copyWith(
                  color: selected ? tokens.action : tokens.muted,
                  fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _MoneyOverview extends StatelessWidget {
  const _MoneyOverview({required this.invoices});

  final List<MobileBusinessRecord> invoices;

  @override
  Widget build(BuildContext context) {
    final totals = <String, _CurrencyTotals>{};
    for (final invoice in invoices) {
      if (invoice.stringValue('status') != 'issued') continue;
      final currency = invoice.stringValue('currency');
      final amount = invoice.integerValue('totalMinor');
      final received = invoice.integerValue('collectedMinor');
      final outstanding = invoice.integerValue('outstandingMinor');
      if (currency == null ||
          amount == null ||
          received == null ||
          outstanding == null) {
        continue;
      }
      final value = totals.putIfAbsent(currency, _CurrencyTotals.new);
      value.invoiced += amount;
      value.received += received;
      value.outstanding += outstanding;
    }
    if (totals.isEmpty) return const _MoneyEmptyState();
    return Column(
      children: [
        for (final entry in totals.entries)
          _CurrencySummaryCard(currency: entry.key, totals: entry.value),
      ],
    );
  }
}

class _CurrencyTotals {
  int invoiced = 0;
  int received = 0;
  int outstanding = 0;
}

class _CurrencySummaryCard extends StatelessWidget {
  const _CurrencySummaryCard({required this.currency, required this.totals});

  final String currency;
  final _CurrencyTotals totals;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: tokens.paper,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: tokens.line),
      ),
      child: Column(
        children: [
          _MoneyAmountRow(
            label: 'Invoiced revenue',
            amount: totals.invoiced,
            currency: currency,
          ),
          const SizedBox(height: 10),
          _MoneyAmountRow(
            label: 'Cash received',
            amount: totals.received,
            currency: currency,
          ),
          const SizedBox(height: 10),
          _MoneyAmountRow(
            label: 'Outstanding',
            amount: totals.outstanding,
            currency: currency,
          ),
        ],
      ),
    );
  }
}

class _MoneyAmountRow extends StatelessWidget {
  const _MoneyAmountRow({
    required this.label,
    required this.amount,
    required this.currency,
  });

  final String label;
  final int amount;
  final String currency;

  @override
  Widget build(BuildContext context) => Row(
    children: [
      Expanded(
        child: Text(
          label,
          style: context.textTheme.bodySmall?.copyWith(
            color: context.mobileTokens.muted,
          ),
        ),
      ),
      Text(
        _formatMoney(amount, currency),
        style: context.textTheme.titleSmall?.copyWith(
          color: context.mobileTokens.ink,
          fontWeight: FontWeight.w700,
        ),
      ),
    ],
  );
}

class _MoneyRecordTile extends StatelessWidget {
  const _MoneyRecordTile({
    required this.invoice,
    required this.records,
    required this.onRecordChanged,
    super.key,
  });

  final MobileBusinessRecord invoice;
  final MobileMoneyRecords records;
  final VoidCallback onRecordChanged;

  @override
  Widget build(BuildContext context) {
    final lines = _invoiceLines(invoice);
    final title = lines.firstOrNull?['description'];
    final clientName = _clientName(invoice.stringValue('clientId'), records);
    final status = _invoiceStatus(invoice);
    final currency = invoice.stringValue('currency') ?? '';
    final amount = invoice.integerValue('totalMinor') ?? 0;
    final subtitle = '$clientName · $status';
    void openDetail() {
      unawaited(
        Navigator.of(context).push<bool>(
          MaterialPageRoute<bool>(
            builder: (_) => _MoneyInvoiceDetailPage(
              invoice: invoice,
              records: records,
              onRecordChanged: onRecordChanged,
            ),
          ),
        ),
      );
    }

    return Container(
      decoration: BoxDecoration(
        border: Border(bottom: BorderSide(color: context.mobileTokens.line)),
      ),
      child: Semantics(
        button: true,
        label: '${title is String ? title : 'Invoice'}. $subtitle',
        onTap: openDetail,
        child: ExcludeSemantics(
          child: Material(
            color: Colors.transparent,
            child: InkWell(
              onTap: openDetail,
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 16),
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            title is String && title.trim().isNotEmpty
                                ? title
                                : 'Invoice',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: context.textTheme.bodyMedium?.copyWith(
                              color: context.mobileTokens.ink,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            subtitle,
                            style: context.textTheme.bodySmall?.copyWith(
                              color: context.mobileTokens.muted,
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 12),
                    Text(
                      _formatMoney(amount, currency),
                      style: context.textTheme.bodyMedium?.copyWith(
                        color: context.mobileTokens.ink,
                        fontWeight: FontWeight.w700,
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

class _MoneyEmptyState extends StatelessWidget {
  const _MoneyEmptyState();

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 26),
    child: Text(
      'No invoices yet',
      style: context.textTheme.titleSmall?.copyWith(
        color: context.mobileTokens.muted,
      ),
    ),
  );
}

List<Map> _invoiceLines(MobileBusinessRecord invoice) {
  final lines = invoice.value['lines'];
  return lines is List ? lines.whereType<Map>().toList() : const [];
}

String _invoiceStatus(MobileBusinessRecord invoice) {
  final status = invoice.stringValue('status');
  if (status == 'draft') return 'Draft';
  if (status == 'void') return 'Void';
  if (status != 'issued') return 'Invoice';
  if (invoice.integerValue('outstandingMinor') == 0) return 'Paid';
  final dueAt = invoice.integerValue('dueAt');
  if (dueAt != null && dueAt < DateTime.now().millisecondsSinceEpoch ~/ 1000) {
    return 'Overdue';
  }
  return 'Awaiting payment';
}

String _clientName(String? clientId, MobileMoneyRecords records) {
  if (clientId == null) return 'Client';
  for (final client in records.clientHeads) {
    if (client.stringValue('clientId') == clientId) {
      return client.stringValue('displayName') ?? 'Client';
    }
  }
  return 'Client';
}

String _formatMoney(int amountMinor, String currency) {
  return '$currency ${_formatMajorAmount(amountMinor, currency)}';
}
