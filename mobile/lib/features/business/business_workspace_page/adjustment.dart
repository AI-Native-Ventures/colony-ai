part of '../business_workspace_page.dart';

class BusinessAdjustmentFlow extends HookConsumerWidget {
  const BusinessAdjustmentFlow({
    required this.invoice,
    required this.clientName,
    this.onDenialChanged,
    required this.onSaved,
    super.key,
  });

  final MobileBusinessRecord invoice;
  final String clientName;
  final ValueChanged<bool>? onDenialChanged;
  final VoidCallback onSaved;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final type = useState<String?>(null);
    final stage = useState<_AdjustmentStage>(_AdjustmentStage.entry);
    final busy = useState(false);
    final entryError = useState<String?>(null);
    final amountController = useTextEditingController();
    final reasonController = useTextEditingController();
    final currency = invoice.stringValue('currency') ?? '';
    final tokens = context.mobileTokens;

    int? parsedAmount() =>
        _parseAdjustmentAmount(amountController.text, currency);

    void openReview() {
      final amount = parsedAmount();
      if (type.value == null || amount == null || amount <= 0) {
        entryError.value = 'Choose a type and enter a valid amount.';
        return;
      }
      if (reasonController.text.trim().isEmpty) {
        entryError.value = 'Add a reason before reviewing.';
        return;
      }
      entryError.value = null;
      stage.value = _AdjustmentStage.review;
    }

    Future<void> save() async {
      final amount = parsedAmount();
      final adjustmentType = type.value;
      if (busy.value ||
          amount == null ||
          amount <= 0 ||
          adjustmentType == null ||
          reasonController.text.trim().isEmpty) {
        return;
      }
      busy.value = true;
      try {
        await ref
            .read(mobileBusinessRepositoryProvider)
            .recordAdjustment(
              invoice: invoice,
              adjustmentType: adjustmentType,
              amountMinor: amount,
              reason: reasonController.text,
              evidenceRef: invoice.event.id,
              occurredAt: DateTime.now().toUtc().millisecondsSinceEpoch ~/ 1000,
            );
        stage.value = _AdjustmentStage.saved;
      } catch (error) {
        final denied = _looksLikeAdjustmentDenial(error);
        stage.value = denied
            ? _AdjustmentStage.denied
            : _AdjustmentStage.failed;
        onDenialChanged?.call(denied);
      } finally {
        busy.value = false;
      }
    }

    return switch (stage.value) {
      _AdjustmentStage.entry || _AdjustmentStage.failed => ListView(
        padding: const EdgeInsets.fromLTRB(20, 18, 20, 24),
        children: [
          _BusinessHero(
            eyebrow: _adjustmentInvoiceEyebrow(invoice),
            title: 'Explain the change.',
            subtitle: 'Adjust a business invoice, not Colony credits.',
          ),
          if (stage.value == _AdjustmentStage.failed) ...[
            const SizedBox(height: 16),
            _BusinessNotice(
              title: 'Your changes were not saved',
              body:
                  'Everything you typed is kept. Try again when the connection returns.',
              accentColor: const Color(0xFFC86465),
            ),
          ],
          const SizedBox(height: 16),
          Text(
            'Adjustment type',
            style: context.textTheme.labelMedium?.copyWith(
              color: tokens.ink,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 8),
          DropdownButtonFormField<String>(
            key: ValueKey(type.value),
            initialValue: type.value,
            style: context.textTheme.bodyMedium,
            decoration: const InputDecoration(
              filled: true,
              hintText: 'Choose adjustment type',
              constraints: BoxConstraints(minHeight: 46),
            ),
            items: const [
              DropdownMenuItem(
                value: 'credit_note',
                child: Text('Credit adjustment'),
              ),
              DropdownMenuItem(value: 'refund', child: Text('Refund record')),
              DropdownMenuItem(value: 'write_off', child: Text('Write-off')),
            ],
            onChanged: (value) {
              type.value = value;
              entryError.value = null;
            },
          ),
          const SizedBox(height: 16),
          Text(
            'Amount, $currency',
            style: context.textTheme.labelMedium?.copyWith(
              color: tokens.ink,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 8),
          TextField(
            controller: amountController,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            decoration: const InputDecoration(
              filled: true,
              constraints: BoxConstraints(minHeight: 46),
            ),
            style: context.textTheme.bodyMedium,
            onChanged: (_) => entryError.value = null,
          ),
          const SizedBox(height: 16),
          Text(
            'Reason',
            style: context.textTheme.labelMedium?.copyWith(
              color: tokens.ink,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 8),
          TextField(
            controller: reasonController,
            minLines: 4,
            maxLines: 5,
            decoration: const InputDecoration(
              filled: true,
              constraints: BoxConstraints(minHeight: 112),
            ),
            style: context.textTheme.bodyMedium,
            onChanged: (_) => entryError.value = null,
          ),
          if (entryError.value != null) ...[
            const SizedBox(height: 8),
            Text(
              entryError.value!,
              style: context.textTheme.bodySmall?.copyWith(color: tokens.error),
            ),
          ],
          const SizedBox(height: 28),
          _BusinessActionButton(
            label: 'Review adjustment',
            onPressed: busy.value ? null : openReview,
          ),
        ],
      ),
      _AdjustmentStage.review => ListView(
        padding: const EdgeInsets.fromLTRB(20, 18, 20, 24),
        children: [
          _BusinessHero(
            eyebrow: 'REVIEW ADJUSTMENT',
            title: _adjustmentTypeLabel(type.value),
            subtitle: _adjustmentClientSubtitle(clientName, invoice),
            apricot: true,
          ),
          _BusinessDetailRow(
            label: 'Amount',
            value: _enteredAdjustmentAmount(amountController.text, currency),
          ),
          _BusinessDetailRow(
            label: 'Effect',
            value: _adjustmentEffect(type.value),
          ),
          _BusinessDetailRow(
            label: 'Reason',
            value: reasonController.text.trim(),
          ),
          const SizedBox(height: 18),
          _BusinessActionButton(
            label: busy.value ? 'Recording adjustment' : 'Record adjustment',
            onPressed: busy.value ? null : save,
          ),
          const SizedBox(height: 10),
          _BusinessActionButton(
            label: 'Edit adjustment',
            onPressed: busy.value
                ? null
                : () => stage.value = _AdjustmentStage.entry,
            secondary: true,
          ),
          const SizedBox(height: 14),
          const _BusinessNotice(
            title: 'A record, not a transfer',
            body: 'This does not refund a payment or charge the customer.',
          ),
        ],
      ),
      _AdjustmentStage.saved => ListView(
        padding: const EdgeInsets.fromLTRB(20, 18, 20, 24),
        children: [
          const _BusinessNotice(
            title: 'Adjustment recorded',
            body:
                'The invoice balance and history now include the reviewed adjustment. No money moved.',
            accentColor: Color(0xFF5B9374),
          ),
          const SizedBox(height: 10),
          _BusinessActionButton(label: 'Back to proposal', onPressed: onSaved),
        ],
      ),
      _AdjustmentStage.denied => ListView(
        padding: const EdgeInsets.fromLTRB(20, 18, 20, 24),
        children: [
          _BusinessNotice(
            title: 'You can view, but cannot change this',
            body:
                'An authorized person can make the update. Your draft has been kept.',
            accentColor: const Color(0xFFC86465),
          ),
          const SizedBox(height: 10),
          _BusinessActionButton(
            label: 'Back to the record',
            onPressed: () {
              stage.value = _AdjustmentStage.entry;
              onDenialChanged?.call(false);
            },
            soft: true,
          ),
        ],
      ),
    };
  }
}

String _adjustmentInvoiceEyebrow(MobileBusinessRecord invoice) {
  final number = _adjustmentInvoiceNumber(invoice);
  return number == null ? 'INVOICE' : 'INVOICE $number';
}

String? _adjustmentInvoiceNumber(MobileBusinessRecord invoice) {
  final number = invoice.stringValue('invoiceNumber')?.trim();
  return number == null || number.isEmpty ? null : number;
}

String _adjustmentClientSubtitle(
  String clientName,
  MobileBusinessRecord invoice,
) {
  final number = _adjustmentInvoiceNumber(invoice);
  return number == null ? clientName : '$clientName · $number';
}

enum _AdjustmentStage { entry, review, saved, failed, denied }

String _adjustmentTypeLabel(String? type) => switch (type) {
  'credit_note' => 'Credit adjustment',
  'refund' => 'Refund adjustment',
  'write_off' => 'Write-off adjustment',
  _ => 'Adjustment',
};

String _adjustmentEffect(String? type) => switch (type) {
  'credit_note' => 'Reduces amount due',
  'refund' => 'Records an external refund',
  'write_off' => 'Writes off the balance',
  _ => '',
};

int? _parseAdjustmentAmount(String input, String currency) {
  final value = input.trim().replaceAll(',', '.');
  final parts = value.split('.');
  if (parts.length > 2 ||
      parts.any((part) => part.isNotEmpty && int.tryParse(part) == null)) {
    return null;
  }
  final digits = NumberFormat.simpleCurrency(name: currency).decimalDigits ?? 2;
  final whole = int.tryParse(parts.first.isEmpty ? '0' : parts.first);
  if (whole == null) return null;
  final fraction = parts.length == 1 ? '' : parts[1];
  if (fraction.length > digits) return null;
  final scale = math.pow(10, digits).toInt();
  final minorFraction = int.tryParse(fraction.padRight(digits, '0')) ?? 0;
  return whole * scale + minorFraction;
}

String _enteredAdjustmentAmount(String input, String currency) {
  final value = input.trim();
  return value.isEmpty ? currency : '$currency $value';
}

bool _looksLikeAdjustmentDenial(Object error) {
  final message = error.toString().toLowerCase();
  return message.contains('permission denied') ||
      message.contains('not authorized') ||
      message.contains('unauthorized') ||
      message.contains('forbidden');
}
