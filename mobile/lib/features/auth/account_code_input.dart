import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_hooks/flutter_hooks.dart';

import '../../shared/theme/theme.dart';
import 'account_flow_palette.dart';

/// Six accessible one-time-code cells with SMS paste distribution.
class AccountCodeInput extends HookWidget {
  const AccountCodeInput({
    required this.label,
    required this.onChanged,
    super.key,
  });

  final String label;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    final controllers = useMemoized(
      () => List.generate(6, (_) => TextEditingController()),
    );
    String currentValue() => controllers.map((item) => item.text).join();
    final focusNodesRef = useRef<List<FocusNode>>([]);
    final onChangedRef = useRef(onChanged);
    onChangedRef.value = onChanged;
    final focusNodes = useMemoized(
      () => List.generate(
        6,
        (index) => FocusNode(
          onKeyEvent: (_, event) {
            if (event is! KeyDownEvent) return KeyEventResult.ignored;
            final nodes = focusNodesRef.value;
            if (event.logicalKey == LogicalKeyboardKey.arrowLeft && index > 0) {
              nodes[index - 1].requestFocus();
              return KeyEventResult.handled;
            }
            if (event.logicalKey == LogicalKeyboardKey.arrowRight &&
                index < 5) {
              nodes[index + 1].requestFocus();
              return KeyEventResult.handled;
            }
            if (event.logicalKey == LogicalKeyboardKey.backspace &&
                index > 0 &&
                controllers[index].text.isEmpty) {
              final previous = index - 1;
              controllers[previous].clear();
              onChangedRef.value(currentValue());
              nodes[previous].requestFocus();
              return KeyEventResult.handled;
            }
            return KeyEventResult.ignored;
          },
        ),
      ),
    );
    focusNodesRef.value = focusNodes;
    final isDistributingPaste = useRef(false);
    useEffect(() {
      return () {
        for (final controller in controllers) {
          controller.dispose();
        }
        for (final focusNode in focusNodes) {
          focusNode.dispose();
        }
      };
    }, [controllers, focusNodes]);

    void setDigit(int index, String value) {
      if (isDistributingPaste.value) return;
      final digits = value.replaceAll(RegExp(r'\D'), '');
      if (digits.length > 1) {
        isDistributingPaste.value = true;
        for (var offset = 0; offset < 6 - index; offset++) {
          final targetIndex = index + offset;
          final digit = offset < digits.length ? digits[offset] : '';
          controllers[targetIndex].value = TextEditingValue(
            text: digit,
            selection: TextSelection.collapsed(offset: digit.length),
          );
        }
        isDistributingPaste.value = false;
        onChanged(currentValue());
        final nextEmpty = controllers.indexWhere((item) => item.text.isEmpty);
        focusNodes[nextEmpty < 0 ? 5 : nextEmpty].requestFocus();
        return;
      }

      onChanged(currentValue());
      if (digits.isNotEmpty && index < 5) {
        focusNodes[index + 1].requestFocus();
      }
    }

    final brightness = Theme.of(context).brightness;
    final border = OutlineInputBorder(
      borderRadius: BorderRadius.circular(Radii.field),
      borderSide: BorderSide(color: AccountFlowPalette.line(brightness)),
    );
    return Semantics(
      container: true,
      label: label,
      child: Row(
        children: [
          for (var index = 0; index < 6; index++) ...[
            if (index > 0) const SizedBox(width: Grid.xxs),
            Expanded(
              child: Semantics(
                label: 'Digit ${index + 1} of 6',
                textField: true,
                child: TextField(
                  controller: controllers[index],
                  focusNode: focusNodes[index],
                  textAlign: TextAlign.center,
                  keyboardType: TextInputType.number,
                  textInputAction: index == 5
                      ? TextInputAction.done
                      : TextInputAction.next,
                  autofillHints: index == 0
                      ? const [AutofillHints.oneTimeCode]
                      : null,
                  inputFormatters: [
                    FilteringTextInputFormatter.digitsOnly,
                    LengthLimitingTextInputFormatter(6),
                  ],
                  style: context.textTheme.titleLarge?.copyWith(
                    fontSize: 20,
                    fontWeight: FontWeight.w600,
                  ),
                  decoration: InputDecoration(
                    filled: true,
                    fillColor: AccountFlowPalette.soft(brightness),
                    isDense: true,
                    constraints: const BoxConstraints.tightFor(height: 52),
                    contentPadding: const EdgeInsets.symmetric(
                      horizontal: Grid.xxs,
                      vertical: 14,
                    ),
                    border: border,
                    enabledBorder: border,
                    focusedBorder: border.copyWith(
                      borderSide: BorderSide(
                        color: AccountFlowPalette.blue(brightness),
                      ),
                    ),
                  ),
                  onChanged: (value) => setDigit(index, value),
                  onTap: () =>
                      controllers[index].selection = TextSelection.collapsed(
                        offset: controllers[index].text.length,
                      ),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}
