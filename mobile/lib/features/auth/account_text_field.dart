import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../shared/theme/theme.dart';

/// Theme-native labelled text input for account forms.
class AccountTextField extends StatelessWidget {
  const AccountTextField({
    required this.controller,
    required this.label,
    this.keyboardType,
    this.textInputAction,
    this.obscureText = false,
    this.autofillHints,
    this.maxLength,
    this.inputFormatters,
    this.onFieldSubmitted,
    this.validator,
    super.key,
  });

  final TextEditingController controller;
  final String label;
  final TextInputType? keyboardType;
  final TextInputAction? textInputAction;
  final bool obscureText;
  final Iterable<String>? autofillHints;
  final int? maxLength;
  final List<TextInputFormatter>? inputFormatters;
  final ValueChanged<String>? onFieldSubmitted;
  final FormFieldValidator<String>? validator;

  @override
  Widget build(BuildContext context) {
    return TextFormField(
      controller: controller,
      decoration: InputDecoration(
        labelText: label,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(Radii.md),
        ),
        counterText: maxLength == null ? null : '',
      ),
      keyboardType: keyboardType,
      textInputAction: textInputAction,
      obscureText: obscureText,
      autofillHints: autofillHints,
      maxLength: maxLength,
      inputFormatters: inputFormatters,
      onFieldSubmitted: onFieldSubmitted,
      validator: validator,
      autocorrect: false,
      enableSuggestions: false,
    );
  }
}
