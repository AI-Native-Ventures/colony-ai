import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../shared/theme/theme.dart';
import 'account_flow_palette.dart';

/// Theme-native labelled text input for account forms.
class AccountTextField extends StatelessWidget {
  const AccountTextField({
    required this.controller,
    required this.label,
    this.keyboardType,
    this.textInputAction,
    this.textCapitalization = TextCapitalization.none,
    this.obscureText = false,
    this.autofillHints,
    this.maxLength,
    this.inputFormatters,
    this.onFieldSubmitted,
    this.validator,
    this.focusNode,
    this.suffixIcon,
    this.labelFieldSpacing = Grid.xxs,
    this.useSoftFill = false,
    this.readOnly = false,
    super.key,
  });

  final TextEditingController controller;
  final String label;
  final TextInputType? keyboardType;
  final TextInputAction? textInputAction;
  final TextCapitalization textCapitalization;
  final bool obscureText;
  final Iterable<String>? autofillHints;
  final int? maxLength;
  final List<TextInputFormatter>? inputFormatters;
  final ValueChanged<String>? onFieldSubmitted;
  final FormFieldValidator<String>? validator;
  final FocusNode? focusNode;
  final Widget? suffixIcon;

  /// Space between the field label and input, in logical pixels.
  final double labelFieldSpacing;

  /// Uses the account form's soft surface for fields on code and reset screens.
  final bool useSoftFill;

  final bool readOnly;

  @override
  Widget build(BuildContext context) {
    final brightness = Theme.of(context).brightness;
    final outline = OutlineInputBorder(
      borderRadius: BorderRadius.circular(9),
      borderSide: BorderSide(color: AccountFlowPalette.line(brightness)),
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: context.textTheme.labelMedium?.copyWith(
            fontSize: 11,
            fontWeight: FontWeight.w600,
            color: AccountFlowPalette.ink(brightness),
          ),
        ),
        SizedBox(height: labelFieldSpacing),
        TextFormField(
          controller: controller,
          focusNode: focusNode,
          readOnly: readOnly,
          decoration: InputDecoration(
            filled: true,
            fillColor: useSoftFill
                ? AccountFlowPalette.soft(brightness)
                : AccountFlowPalette.paper(brightness),
            isDense: true,
            constraints: const BoxConstraints(minHeight: 46),
            contentPadding: const EdgeInsets.symmetric(
              horizontal: 12,
              vertical: 13,
            ),
            border: outline,
            enabledBorder: outline,
            disabledBorder: outline,
            focusedBorder: outline.copyWith(
              borderSide: BorderSide(
                color: AccountFlowPalette.blue(brightness),
              ),
            ),
            errorBorder: outline.copyWith(
              borderSide: BorderSide(
                color: AccountFlowPalette.error(brightness),
              ),
            ),
            focusedErrorBorder: outline.copyWith(
              borderSide: BorderSide(
                color: AccountFlowPalette.error(brightness),
              ),
            ),
            counterText: maxLength == null ? null : '',
            suffixIcon: suffixIcon,
          ),
          style: TextStyle(
            fontFamily: 'Manrope',
            fontSize: 13,
            height: 1.5,
            color: AccountFlowPalette.ink(brightness),
          ),
          keyboardType: keyboardType,
          textInputAction: textInputAction,
          textCapitalization: textCapitalization,
          obscureText: obscureText,
          autofillHints: autofillHints,
          maxLength: maxLength,
          inputFormatters: inputFormatters,
          onFieldSubmitted: onFieldSubmitted,
          validator: validator,
          autocorrect: false,
          enableSuggestions: false,
        ),
      ],
    );
  }
}
