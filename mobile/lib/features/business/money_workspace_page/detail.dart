part of '../money_workspace_page.dart';

class _MoneyInvoiceDetailPage extends HookConsumerWidget {
  const _MoneyInvoiceDetailPage({
    required this.invoice,
    required this.records,
    required this.onRecordChanged,
  });

  final MobileBusinessRecord invoice;
  final MobileMoneyRecords records;
  final VoidCallback onRecordChanged;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tokens = context.mobileTokens;
    final currency = invoice.stringValue('currency') ?? '';
    final amount = invoice.integerValue('totalMinor') ?? 0;
    final received = invoice.integerValue('collectedMinor') ?? 0;
    final clientName = _clientName(invoice.stringValue('clientId'), records);
    final lines = _invoiceLines(invoice);
    final title = lines.firstOrNull?['description'];
    final status = _invoiceStatus(invoice);
    final draft = invoice.stringValue('status') == 'draft';
    final canReceive =
        invoice.stringValue('status') == 'issued' &&
        (invoice.integerValue('outstandingMinor') ?? 0) > 0;

    Future<void> open(Widget page) async {
      final changed = await Navigator.of(
        context,
      ).push<bool>(MaterialPageRoute<bool>(builder: (_) => page));
      if (changed == true && context.mounted) {
        onRecordChanged();
        Navigator.of(context).pop(true);
      }
    }

    return Material(
      color: tokens.canvas,
      child: Column(
        children: [
          _MoneyPageHeader(
            title: 'Invoice',
            onBack: () => unawaited(Navigator.of(context).maybePop()),
          ),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(20, 16, 20, 28),
              children: [
                Text(
                  title is String && title.trim().isNotEmpty
                      ? title
                      : 'Invoice',
                  style: context.textTheme.headlineSmall?.copyWith(
                    color: tokens.ink,
                    fontWeight: FontWeight.w800,
                    letterSpacing: -0.7,
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  clientName,
                  style: context.textTheme.bodyMedium?.copyWith(
                    color: tokens.muted,
                  ),
                ),
                const SizedBox(height: 18),
                _MoneyDetailRow(
                  label: 'Amount',
                  value: _formatMoney(amount, currency),
                ),
                _MoneyDetailRow(label: 'State', value: status),
                _MoneyDetailRow(
                  label: 'Received',
                  value: _formatMoney(received, currency),
                ),
                _MoneyDetailRow(label: 'Source', value: 'Proposal'),
                if (invoice.integerValue('dueAt') case final dueAt?)
                  _MoneyDetailRow(label: 'Due', value: _formatDate(dueAt)),
                if (draft) ...[
                  const SizedBox(height: 18),
                  _MoneyActionButton(
                    label: 'Edit record',
                    onPressed: () => unawaited(
                      open(
                        _MoneyEditInvoicePage(
                          invoice: invoice,
                          clientName: clientName,
                        ),
                      ),
                    ),
                    filled: false,
                  ),
                  _MoneyActionButton(
                    label: 'Review & issue invoice',
                    onPressed: () => unawaited(
                      open(
                        _MoneyIssueInvoicePage(
                          invoice: invoice,
                          clientName: clientName,
                        ),
                      ),
                    ),
                  ),
                ],
                if (canReceive) ...[
                  const SizedBox(height: 18),
                  _MoneyActionButton(
                    label: 'Record payment',
                    onPressed: () => unawaited(
                      open(
                        _MoneyPaymentPage(
                          invoice: invoice,
                          clientName: clientName,
                        ),
                      ),
                    ),
                    filled: false,
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _MoneyDetailRow extends StatelessWidget {
  const _MoneyDetailRow({required this.label, required this.value});

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
          child: Text(
            label,
            style: context.textTheme.bodySmall?.copyWith(
              color: context.mobileTokens.muted,
            ),
          ),
        ),
        Expanded(
          child: Text(
            value,
            textAlign: TextAlign.end,
            style: context.textTheme.bodySmall?.copyWith(
              color: context.mobileTokens.ink,
            ),
          ),
        ),
      ],
    ),
  );
}

class _MoneyEditInvoicePage extends HookConsumerWidget {
  const _MoneyEditInvoicePage({
    required this.invoice,
    required this.clientName,
  });

  final MobileBusinessRecord invoice;
  final String clientName;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final repository = ref.watch(mobileBusinessRepositoryProvider);
    final error = useState<String?>(null);
    final busy = useState(false);
    final currency = invoice.stringValue('currency') ?? '';
    final lines = _invoiceLines(invoice);
    final lineFields = useMemoized(
      () => [
        for (final line in lines)
          _InvoiceLineFields(
            description: line['description'] is String
                ? line['description'] as String
                : '',
            amount:
                line['quantityHundredths'] is int &&
                    line['unitAmountMinor'] is int
                ? (line['quantityHundredths'] as int) *
                      (line['unitAmountMinor'] as int) ~/
                      100
                : 0,
            currency: currency,
          ),
      ],
      [invoice.event.id],
    );
    final dueDate = useTextEditingController(
      text: invoice.integerValue('dueAt') == null
          ? ''
          : _formatDate(invoice.integerValue('dueAt')!),
    );
    final taxDraft = useState(_taxDraftFromInvoice(invoice));
    final taxLineFields = useMemoized(
      () => [
        for (final tax in taxDraft.value.taxLines)
          _TaxLineFields(
            tax.label ?? '',
            _basisPointsToRate(tax.rateBasisPoints),
          ),
      ],
      [invoice.event.id],
    );
    useEffect(() {
      return () {
        for (final line in lineFields) {
          line.dispose();
        }
        for (final tax in taxLineFields) {
          tax.dispose();
        }
      };
    }, [lineFields, taxLineFields]);

    Future<void> editTax() async {
      final result = await Navigator.of(context).push<Object?>(
        MaterialPageRoute<Object?>(
          builder: (_) => _MoneyTaxPage(
            invoice: invoice,
            clientName: clientName,
            initialDraft: taxDraft.value,
          ),
        ),
      );
      if (!context.mounted) return;
      if (result is _MoneyTaxBackToMoney) {
        Navigator.of(context).pop(true);
      } else if (result is _MoneyTaxDraft) {
        taxDraft.value = result;
      }
    }

    Future<void> save() async {
      busy.value = true;
      error.value = null;
      try {
        final editedLines = <Object?>[];
        for (var index = 0; index < lines.length; index++) {
          final line = lines[index];
          final fields = lineFields[index];
          final total = _parseMoneyAmount(fields.amount.text, currency);
          final quantity = line['quantityHundredths'];
          if (quantity is! int || quantity <= 0 || total < 0) {
            throw const FormatException('Invoice line amount is invalid.');
          }
          final unitAmount =
              BigInt.from(total) * BigInt.from(100) ~/ BigInt.from(quantity);
          if (unitAmount * BigInt.from(quantity) ~/ BigInt.from(100) !=
              BigInt.from(total)) {
            throw const FormatException(
              'This amount cannot be represented by the line quantity.',
            );
          }
          editedLines.add({
            ...line.map((key, value) => MapEntry(key as String, value)),
            'description': fields.description.text.trim(),
            'unitAmountMinor': unitAmount.toInt(),
          });
        }
        final dueAtValue = dueDate.text.trim().isEmpty
            ? null
            : _dateTextToUnix(dueDate.text);
        await repository.editDraftInvoice(
          invoice: invoice,
          lines: editedLines,
          taxLines: taxDraft.value.taxLines,
          sellerTaxNumber: taxDraft.value.sellerTaxNumber,
          customerTaxNumber: taxDraft.value.customerTaxNumber,
          dueAt: dueAtValue,
        );
        if (context.mounted) Navigator.of(context).pop(true);
      } catch (exception) {
        error.value = _displayError(exception);
      } finally {
        busy.value = false;
      }
    }

    return _MoneyFormPage(
      title: 'Edit record',
      error: error.value,
      busy: busy.value,
      onBack: () => unawaited(Navigator.of(context).maybePop()),
      onSubmit: save,
      submitLabel: 'Save record',
      children: [
        for (var index = 0; index < lineFields.length; index++) ...[
          _MoneyTextField(
            controller: lineFields[index].description,
            label: 'Description',
          ),
          _MoneyTextField(
            controller: lineFields[index].amount,
            label: 'Amount · $currency',
            numeric: true,
          ),
        ],
        const SizedBox(height: 12),
        _MoneyDetailRow(label: 'Client', value: clientName),
        _MoneyDateField(controller: dueDate),
        const SizedBox(height: 8),
        Text(
          'Record reflects your business ledger; no money is transferred.',
          style: context.textTheme.bodySmall?.copyWith(
            color: context.mobileTokens.muted,
            height: 1.5,
          ),
        ),
        const SizedBox(height: 14),
        OutlinedButton(
          onPressed: busy.value ? null : editTax,
          child: const Text('Optional tax details'),
        ),
        if (taxDraft.value.taxLines.isNotEmpty) ...[
          const SizedBox(height: 8),
          _MoneyDetailRow(
            label: 'Tax',
            value: taxDraft.value.taxLines
                .map((line) => '${_basisPointsToRate(line.rateBasisPoints)}%')
                .join(', '),
          ),
        ],
      ],
    );
  }
}

class _MoneyIssueInvoicePage extends HookConsumerWidget {
  const _MoneyIssueInvoicePage({
    required this.invoice,
    required this.clientName,
  });

  final MobileBusinessRecord invoice;
  final String clientName;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final repository = ref.watch(mobileBusinessRepositoryProvider);
    final error = useState<String?>(null);
    final busy = useState(false);
    final confirmed = useState(false);
    final currency = invoice.stringValue('currency') ?? '';
    final title = _invoiceLines(invoice).firstOrNull?['description'];

    Future<void> issue() async {
      if (!confirmed.value) return;
      busy.value = true;
      error.value = null;
      try {
        await repository.issueInvoice(invoice);
        if (context.mounted) Navigator.of(context).pop(true);
      } catch (exception) {
        error.value = _displayError(exception);
      } finally {
        busy.value = false;
      }
    }

    return _MoneyFormPage(
      title: 'Issue invoice',
      error: error.value,
      busy: busy.value,
      onBack: () => unawaited(Navigator.of(context).maybePop()),
      onSubmit: issue,
      submitLabel: 'Issue preview invoice',
      submitEnabled: confirmed.value,
      children: [
        _MoneyDetailRow(label: 'Client', value: clientName),
        _MoneyDetailRow(
          label: 'Description',
          value: title is String ? title : 'Invoice',
        ),
        _MoneyDetailRow(
          label: 'Amount',
          value: _formatMoney(
            invoice.integerValue('totalMinor') ?? 0,
            currency,
          ),
        ),
        if (invoice.integerValue('dueAt') case final dueAt?)
          _MoneyDetailRow(label: 'Due', value: _formatDate(dueAt)),
        const SizedBox(height: 18),
        Text(
          'Issuing records this invoice as revenue. No email is sent in this preview.',
          style: context.textTheme.bodySmall?.copyWith(
            color: context.mobileTokens.muted,
            height: 1.5,
          ),
        ),
        const SizedBox(height: 14),
        _MoneyConfirmation(
          label: 'Confirm invoice details',
          value: confirmed.value,
          onChanged: (value) => confirmed.value = value,
        ),
      ],
    );
  }
}

class _MoneyPaymentPage extends HookConsumerWidget {
  const _MoneyPaymentPage({required this.invoice, required this.clientName});

  final MobileBusinessRecord invoice;
  final String clientName;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final repository = ref.watch(mobileBusinessRepositoryProvider);
    final error = useState<String?>(null);
    final busy = useState(false);
    final confirmed = useState(false);
    final currency = invoice.stringValue('currency') ?? '';
    final amount = useTextEditingController(
      text: _formatMajorAmount(
        invoice.integerValue('outstandingMinor') ?? 0,
        currency,
      ),
    );
    final reference = useTextEditingController();

    Future<void> record() async {
      if (!confirmed.value) return;
      busy.value = true;
      error.value = null;
      try {
        await repository.recordPayment(
          invoice: invoice,
          amountMinor: _parseMoneyAmount(amount.text, currency),
          provider: 'manual',
          providerReference: null,
          occurredAt: DateTime.now().millisecondsSinceEpoch ~/ 1000,
          evidenceRef: reference.text,
        );
        if (context.mounted) Navigator.of(context).pop(true);
      } catch (exception) {
        error.value = _displayError(exception);
      } finally {
        busy.value = false;
      }
    }

    return _MoneyFormPage(
      title: 'Record payment',
      error: error.value,
      busy: busy.value,
      onBack: () => unawaited(Navigator.of(context).maybePop()),
      onSubmit: record,
      submitLabel: 'Record received payment',
      submitEnabled: confirmed.value,
      children: [
        Text(
          _invoiceLines(invoice).firstOrNull?['description'] is String
              ? _invoiceLines(invoice).first['description'] as String
              : 'Invoice',
          style: context.textTheme.headlineSmall?.copyWith(
            color: context.mobileTokens.ink,
            fontWeight: FontWeight.w800,
          ),
        ),
        const SizedBox(height: 16),
        _MoneyTextField(
          controller: amount,
          label: 'Received amount · $currency',
          numeric: true,
        ),
        _MoneyTextField(controller: reference, label: 'Payment reference'),
        const SizedBox(height: 14),
        _MoneyConfirmation(
          label: 'Confirmed received',
          description:
              'This records payment evidence; it does not charge the client.',
          value: confirmed.value,
          onChanged: (value) => confirmed.value = value,
        ),
      ],
    );
  }
}

class _MoneyTaxPage extends HookWidget {
  const _MoneyTaxPage({
    required this.invoice,
    required this.clientName,
    required this.initialDraft,
  });

  final MobileBusinessRecord invoice;
  final String clientName;
  final _MoneyTaxDraft initialDraft;

  @override
  Widget build(BuildContext context) {
    final rows = useState<List<_TaxLineFields>>(
      initialDraft.taxLines.isEmpty
          ? [_TaxLineFields('', '')]
          : [
              for (final line in initialDraft.taxLines)
                _TaxLineFields(
                  line.label ?? '',
                  _basisPointsToRate(line.rateBasisPoints),
                ),
            ],
    );
    final seller = useTextEditingController(
      text: initialDraft.sellerTaxNumber ?? '',
    );
    final customer = useTextEditingController(
      text: initialDraft.customerTaxNumber ?? '',
    );
    final error = useState<String?>(null);
    final currency = invoice.stringValue('currency') ?? '';
    final subtotal = _invoiceSubtotal(invoice);
    useEffect(() {
      return () {
        for (final row in rows.value) {
          row.dispose();
        }
      };
    }, const []);

    Future<void> preview() async {
      try {
        final draft = _MoneyTaxDraft(
          taxLines: [
            for (final row in rows.value)
              MobileInvoiceTaxLine(
                label: row.label.text,
                rateBasisPoints: _parseTaxRate(row.rate.text),
              ),
          ].where((line) => line.rateBasisPoints > 0).toList(),
          sellerTaxNumber: seller.text,
          customerTaxNumber: customer.text,
        );
        final result = await Navigator.of(context).push<Object?>(
          MaterialPageRoute<Object?>(
            builder: (_) => _MoneyTaxPreviewPage(
              invoice: invoice,
              clientName: clientName,
              draft: draft,
            ),
          ),
        );
        if (result is _MoneyTaxBackToMoney && context.mounted) {
          Navigator.of(context).pop(result);
        } else if (result is _MoneyTaxDraft && context.mounted) {
          Navigator.of(context).pop(result);
        }
      } catch (exception) {
        error.value = _displayError(exception);
      }
    }

    return _MoneyFormPage(
      title: 'Invoice',
      subtitle: clientName,
      error: error.value,
      busy: false,
      onBack: () => unawaited(Navigator.of(context).maybePop()),
      onSubmit: preview,
      submitLabel: 'Preview totals',
      children: [
        Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: context.mobileTokens.paper,
            border: Border(
              left: BorderSide(color: context.mobileTokens.action, width: 3),
            ),
            borderRadius: BorderRadius.circular(14),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Tax is optional',
                style: context.textTheme.titleSmall?.copyWith(
                  color: context.mobileTokens.ink,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                'No tax is applied until your business configures it.',
                style: context.textTheme.bodySmall?.copyWith(
                  color: context.mobileTokens.muted,
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        _MoneyDetailRow(
          label: 'Line amount · $currency',
          value: _formatMoney(subtotal, currency),
        ),
        for (final row in rows.value) ...[
          _MoneyTextField(controller: row.label, label: 'Tax label'),
          _MoneyTextField(
            controller: row.rate,
            label: 'Tax rate, %',
            numeric: true,
          ),
        ],
        _MoneyTextField(
          controller: seller,
          label: 'Seller tax number, optional',
        ),
        _MoneyTextField(
          controller: customer,
          label: 'Customer tax number, optional',
        ),
      ],
    );
  }
}

class _MoneyTaxPreviewPage extends StatelessWidget {
  const _MoneyTaxPreviewPage({
    required this.invoice,
    required this.clientName,
    required this.draft,
  });

  final MobileBusinessRecord invoice;
  final String clientName;
  final _MoneyTaxDraft draft;

  @override
  Widget build(BuildContext context) {
    final currency = invoice.stringValue('currency') ?? '';
    final subtotal = _invoiceSubtotal(invoice);
    final tax = _invoiceTaxTotal(invoice, draft.taxLines);
    return Material(
      color: context.mobileTokens.canvas,
      child: Column(
        children: [
          _MoneyPageHeader(
            title: 'Invoice preview',
            onBack: () => unawaited(Navigator.of(context).maybePop()),
          ),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(20, 16, 20, 28),
              children: [
                Container(
                  padding: const EdgeInsets.all(22),
                  decoration: BoxDecoration(
                    gradient: context.appColors.companyWashGradient,
                    borderRadius: BorderRadius.circular(22),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'INVOICE · DRAFT',
                        style: context.textTheme.labelSmall?.copyWith(
                          color: context.mobileTokens.action,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      const SizedBox(height: 10),
                      Text(
                        clientName,
                        style: context.textTheme.headlineSmall?.copyWith(
                          color: context.mobileTokens.ink,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 16),
                _MoneyDetailRow(
                  label: 'Subtotal',
                  value: _formatMoney(subtotal, currency),
                ),
                _MoneyDetailRow(
                  label: 'Tax',
                  value: _formatMoney(tax, currency),
                ),
                _MoneyDetailRow(
                  label: 'Total',
                  value: _formatMoney(subtotal + tax, currency),
                ),
                _MoneyDetailRow(
                  label: 'Seller tax number',
                  value: draft.sellerTaxNumber?.trim().isNotEmpty == true
                      ? draft.sellerTaxNumber!.trim()
                      : 'Not supplied',
                ),
                _MoneyDetailRow(
                  label: 'Customer tax number',
                  value: draft.customerTaxNumber?.trim().isNotEmpty == true
                      ? draft.customerTaxNumber!.trim()
                      : 'Not supplied',
                ),
                const SizedBox(height: 18),
                _MoneyActionButton(
                  label: 'Edit draft',
                  onPressed: () => Navigator.of(context).pop(),
                ),
                _MoneyActionButton(
                  label: 'Back to Money',
                  filled: false,
                  onPressed: () =>
                      Navigator.of(context).pop(const _MoneyTaxBackToMoney()),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _MoneyFormPage extends StatelessWidget {
  const _MoneyFormPage({
    required this.title,
    required this.error,
    required this.busy,
    required this.onBack,
    required this.onSubmit,
    required this.submitLabel,
    required this.children,
    this.subtitle,
    this.submitEnabled = true,
  });

  final String title;
  final String? subtitle;
  final String? error;
  final bool busy;
  final VoidCallback onBack;
  final VoidCallback onSubmit;
  final String submitLabel;
  final bool submitEnabled;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => Material(
    color: context.mobileTokens.canvas,
    child: Column(
      children: [
        _MoneyPageHeader(title: title, subtitle: subtitle, onBack: onBack),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.fromLTRB(20, 8, 20, 20),
            children: [
              ...children,
              if (error != null) ...[
                const SizedBox(height: 12),
                Text(
                  error!,
                  style: context.textTheme.bodySmall?.copyWith(
                    color: context.mobileTokens.error,
                  ),
                ),
              ],
            ],
          ),
        ),
        SafeArea(
          top: false,
          child: Container(
            padding: const EdgeInsets.fromLTRB(20, 12, 20, 16),
            decoration: BoxDecoration(
              color: context.mobileTokens.paper,
              border: Border(top: BorderSide(color: context.mobileTokens.line)),
            ),
            child: SizedBox(
              width: double.infinity,
              child: FilledButton(
                onPressed: busy || !submitEnabled ? null : onSubmit,
                child: Text(busy ? 'Saving' : submitLabel),
              ),
            ),
          ),
        ),
      ],
    ),
  );
}

class _MoneyTextField extends StatelessWidget {
  const _MoneyTextField({
    required this.controller,
    required this.label,
    this.numeric = false,
  });

  final TextEditingController controller;
  final String label;
  final bool numeric;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 12),
    child: TextField(
      controller: controller,
      keyboardType: numeric
          ? const TextInputType.numberWithOptions(decimal: true)
          : TextInputType.text,
      style: context.textTheme.bodySmall,
      decoration: InputDecoration(
        labelText: label,
        filled: true,
        fillColor: context.mobileTokens.paper,
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(13)),
      ),
    ),
  );
}

class _MoneyDateField extends StatelessWidget {
  const _MoneyDateField({required this.controller});

  final TextEditingController controller;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(top: 14),
    child: TextField(
      controller: controller,
      readOnly: true,
      onTap: () async {
        final initial = DateTime.tryParse(controller.text) ?? DateTime.now();
        final result = await showDatePicker(
          context: context,
          initialDate: initial,
          firstDate: DateTime(2000),
          lastDate: DateTime(2100),
        );
        if (result != null) {
          controller.text = _formatDate(result.millisecondsSinceEpoch ~/ 1000);
        }
      },
      decoration: const InputDecoration(
        labelText: 'Due / record date',
        suffixIcon: Icon(Icons.calendar_today_outlined),
        border: OutlineInputBorder(),
      ),
    ),
  );
}

class _MoneyConfirmation extends StatelessWidget {
  const _MoneyConfirmation({
    required this.label,
    required this.value,
    required this.onChanged,
    this.description,
  });

  final String label;
  final String? description;
  final bool value;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) => CheckboxListTile(
    contentPadding: EdgeInsets.zero,
    controlAffinity: ListTileControlAffinity.trailing,
    value: value,
    onChanged: (next) => onChanged(next ?? false),
    title: Text(label, style: context.textTheme.labelLarge),
    subtitle: description == null
        ? null
        : Text(
            description!,
            style: context.textTheme.bodySmall?.copyWith(
              color: context.mobileTokens.muted,
            ),
          ),
  );
}

class _MoneyActionButton extends StatelessWidget {
  const _MoneyActionButton({
    required this.label,
    required this.onPressed,
    this.filled = true,
  });

  final String label;
  final VoidCallback onPressed;
  final bool filled;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 10),
    child: SizedBox(
      width: double.infinity,
      child: filled
          ? FilledButton(onPressed: onPressed, child: Text(label))
          : OutlinedButton(onPressed: onPressed, child: Text(label)),
    ),
  );
}

class _MoneyPageHeader extends StatelessWidget {
  const _MoneyPageHeader({
    required this.title,
    required this.onBack,
    this.subtitle,
    this.backLabel = 'Back to company',
  });

  final String title;
  final String? subtitle;
  final VoidCallback onBack;
  final String backLabel;

  @override
  Widget build(BuildContext context) => SafeArea(
    bottom: false,
    child: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        const SizedBox(height: 24),
        SizedBox(
          height: 68,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 18),
            child: Row(
              children: [
                Semantics(
                  button: true,
                  label: backLabel,
                  onTap: onBack,
                  child: ExcludeSemantics(
                    child: IconButton.filledTonal(
                      onPressed: onBack,
                      icon: const Icon(Icons.arrow_back),
                      style: IconButton.styleFrom(
                        backgroundColor: context.mobileTokens.paper,
                        foregroundColor: context.mobileTokens.ink,
                        side: BorderSide(color: context.mobileTokens.line),
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        title,
                        style: context.textTheme.titleLarge?.copyWith(
                          color: context.mobileTokens.ink,
                          fontWeight: FontWeight.w800,
                          letterSpacing: -0.5,
                          fontSize: 20,
                        ),
                      ),
                      if (subtitle != null)
                        Text(
                          subtitle!,
                          style: context.textTheme.bodySmall?.copyWith(
                            color: context.mobileTokens.muted,
                          ),
                        ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    ),
  );
}

class _InvoiceLineFields {
  _InvoiceLineFields({
    required String description,
    required int amount,
    required String currency,
  }) : description = TextEditingController(text: description),
       amount = TextEditingController(
         text: _formatMajorAmount(amount, currency),
       );

  final TextEditingController description;
  final TextEditingController amount;

  void dispose() {
    description.dispose();
    amount.dispose();
  }
}

class _TaxLineFields {
  _TaxLineFields(String label, String rate)
    : label = TextEditingController(text: label),
      rate = TextEditingController(text: rate);

  final TextEditingController label;
  final TextEditingController rate;

  void dispose() {
    label.dispose();
    rate.dispose();
  }
}

class _MoneyTaxDraft {
  const _MoneyTaxDraft({
    required this.taxLines,
    required this.sellerTaxNumber,
    required this.customerTaxNumber,
  });

  final List<MobileInvoiceTaxLine> taxLines;
  final String? sellerTaxNumber;
  final String? customerTaxNumber;
}

_MoneyTaxDraft _taxDraftFromInvoice(MobileBusinessRecord invoice) {
  final taxLines = invoice.value['taxLines'];
  return _MoneyTaxDraft(
    taxLines: taxLines is List
        ? [
            for (final value in taxLines.whereType<Map>())
              if (value['rateBasisPoints'] is int)
                MobileInvoiceTaxLine(
                  label: value['label'] is String
                      ? value['label'] as String
                      : null,
                  rateBasisPoints: value['rateBasisPoints'] as int,
                ),
          ]
        : const [],
    sellerTaxNumber: invoice.stringValue('sellerTaxNumber'),
    customerTaxNumber: invoice.stringValue('customerTaxNumber'),
  );
}

int _invoiceSubtotal(MobileBusinessRecord invoice) {
  var total = 0;
  for (final line in _invoiceLines(invoice)) {
    final quantity = line['quantityHundredths'];
    final unitAmount = line['unitAmountMinor'];
    if (quantity is int && unitAmount is int) {
      total +=
          (BigInt.from(quantity) * BigInt.from(unitAmount) ~/ BigInt.from(100))
              .toInt();
    }
  }
  return total;
}

int _invoiceTaxTotal(
  MobileBusinessRecord invoice,
  List<MobileInvoiceTaxLine> taxLines,
) {
  var total = BigInt.zero;
  for (final line in _invoiceLines(invoice)) {
    final quantity = line['quantityHundredths'];
    final unitAmount = line['unitAmountMinor'];
    if (quantity is! int || unitAmount is! int) continue;
    final lineMinor =
        BigInt.from(quantity) * BigInt.from(unitAmount) ~/ BigInt.from(100);
    for (final tax in taxLines) {
      total +=
          (lineMinor * BigInt.from(tax.rateBasisPoints) + BigInt.from(5000)) ~/
          BigInt.from(10000);
    }
  }
  return total.toInt();
}

String _formatDate(int timestamp) => DateTime.fromMillisecondsSinceEpoch(
  timestamp * 1000,
).toLocal().toString().split(' ').first;

int _dateTextToUnix(String value) {
  final parsed = DateTime.tryParse(value);
  if (parsed == null) throw const FormatException('Select a valid date.');
  return DateTime(
        parsed.year,
        parsed.month,
        parsed.day,
      ).millisecondsSinceEpoch ~/
      1000;
}

int _currencyDigits(String currency) =>
    NumberFormat.currency(name: currency).decimalDigits ?? 2;

int _currencyScale(String currency) {
  var scale = 1;
  for (var digit = 0; digit < _currencyDigits(currency); digit++) {
    scale *= 10;
  }
  return scale;
}

String _formatMajorAmount(int amountMinor, String currency) {
  final digits = _currencyDigits(currency);
  final scale = _currencyScale(currency);
  final sign = amountMinor < 0 ? '-' : '';
  final positive = amountMinor.abs();
  final whole = (positive ~/ scale).toString();
  final grouped = whole.replaceAllMapped(
    RegExp(r'\B(?=(\d{3})+(?!\d))'),
    (_) => ' ',
  );
  final fractional = digits == 0
      ? ''
      : '.${(positive % scale).toString().padLeft(digits, '0')}';
  return '$sign$grouped$fractional';
}

int _parseMoneyAmount(String input, String currency) {
  final value = input.trim().replaceAll(' ', '');
  final digits = _currencyDigits(currency);
  final pattern = digits == 0
      ? RegExp(r'^\d+$')
      : RegExp('^\\d+(?:\\.\\d{1,$digits})?\$');
  if (!pattern.hasMatch(value)) {
    throw const FormatException('Enter a valid amount.');
  }
  final parts = value.split('.');
  final scale = _currencyScale(currency);
  final whole = BigInt.parse(parts.first) * BigInt.from(scale);
  final fractional = parts.length == 1
      ? BigInt.zero
      : BigInt.parse(parts[1].padRight(digits, '0'));
  final result = whole + fractional;
  if (result <= BigInt.zero || result > BigInt.from(9223372036854775807)) {
    throw const FormatException('Amount is outside the supported range.');
  }
  return result.toInt();
}

String _basisPointsToRate(int basisPoints) {
  final whole = basisPoints ~/ 100;
  final fraction = (basisPoints % 100).toString().padLeft(2, '0');
  return basisPoints % 100 == 0 ? '$whole' : '$whole.$fraction';
}

int _parseTaxRate(String value) {
  final rate = value.trim();
  if (rate.isEmpty) return 0;
  if (!RegExp(r'^\d{1,4}(?:\.\d{1,2})?$').hasMatch(rate)) {
    throw const FormatException('Enter a valid tax rate.');
  }
  final parts = rate.split('.');
  final basisPoints =
      int.parse(parts.first) * 100 +
      (parts.length == 1 ? 0 : int.parse(parts[1].padRight(2, '0')));
  if (basisPoints > 100000) {
    throw const FormatException('Tax rate is outside the supported range.');
  }
  return basisPoints;
}

String _displayError(Object error) {
  if (error is FormatException || error is StateError) {
    return error
        .toString()
        .replaceFirst('FormatException: ', '')
        .replaceFirst('Bad state: ', '');
  }
  return 'This record could not be saved. Your entries are still here.';
}
