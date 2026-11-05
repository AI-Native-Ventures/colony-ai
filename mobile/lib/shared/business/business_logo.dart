import 'package:flutter/material.dart';

import '../theme/theme.dart';

const _logoDevToken = String.fromEnvironment('COLONY_LOGO_DEV_TOKEN');
const _sharedOrListingHosts = <String>{
  'apexcom.co.za',
  'airbnb.com',
  'agoda.com',
  'booking.com',
  'bookings.com',
  'facebook.com',
  'google.com',
  'googleusercontent.com',
  'hotels.com',
  'instagram.com',
  'linkedin.com',
  'linktr.ee',
  'linktree.com',
  'myshopify.com',
  'property24.com',
  'sites.google.com',
  'tiktok.com',
  'tripadvisor.com',
  'trivago.com',
  'twitter.com',
  'weebly.com',
  'wixsite.com',
  'wordpress.com',
  'x.com',
  'yellowpages.com',
  'yelp.com',
};

String? extractBusinessDomain(String? website) {
  final value = website?.trim();
  if (value == null || value.isEmpty) return null;
  final uri = Uri.tryParse(
    RegExp(r'^[a-z][a-z0-9+.-]*://', caseSensitive: false).hasMatch(value)
        ? value
        : 'https://$value',
  );
  if (uri == null ||
      (uri.scheme != 'http' && uri.scheme != 'https') ||
      uri.userInfo.isNotEmpty) {
    return null;
  }
  var domain = uri.host.toLowerCase().replaceFirst(RegExp(r'\.$'), '');
  if (domain.startsWith('www.')) domain = domain.substring(4);
  if (!domain.contains('.') ||
      RegExp(r'^(?:\d{1,3}\.){3}\d{1,3}$').hasMatch(domain)) {
    return null;
  }
  if (_sharedOrListingHosts.any(
    (host) => domain == host || domain.endsWith('.$host'),
  )) {
    return null;
  }
  return domain;
}

String? _safeStoredImageUrl(String? value) {
  final candidate = value?.trim();
  if (candidate == null || candidate.isEmpty) return null;
  final uri = Uri.tryParse(candidate);
  if (uri == null ||
      (uri.scheme != 'http' && uri.scheme != 'https') ||
      uri.userInfo.isNotEmpty ||
      !uri.host.contains('.') ||
      RegExp(r'^(?:\d{1,3}\.){3}\d{1,3}$').hasMatch(uri.host)) {
    return null;
  }
  return uri.toString();
}

String? businessLogoSource({
  required String? website,
  String? logoUrl,
  String? placePhotoUrl,
  String token = _logoDevToken,
}) {
  final domain = extractBusinessDomain(website);
  final cleanToken = token.trim();
  if (domain != null && cleanToken.isNotEmpty) {
    final uri = Uri.https('img.logo.dev', '/$domain', {
      'token': cleanToken,
      'size': '64',
      'format': 'png',
      'retina': 'true',
      'fallback': '404',
    });
    return uri.toString();
  }
  return _safeStoredImageUrl(logoUrl) ?? _safeStoredImageUrl(placePhotoUrl);
}

bool shouldShowBusinessLogo(String? source, {required bool imageFailed}) =>
    source != null && !imageFailed;

class BusinessLogoMark extends StatelessWidget {
  const BusinessLogoMark({
    required this.name,
    required this.website,
    this.logoUrl,
    this.placePhotoUrl,
    this.size = 40,
    super.key,
  });

  final String name;
  final String? website;
  final String? logoUrl;
  final String? placePhotoUrl;
  final double size;

  @override
  Widget build(BuildContext context) {
    final source = businessLogoSource(
      website: website,
      logoUrl: logoUrl,
      placePhotoUrl: placePhotoUrl,
    );
    return SizedBox.square(
      dimension: size,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(size * 0.25),
        child:
            source != null && shouldShowBusinessLogo(source, imageFailed: false)
            ? Image.network(
                source,
                fit: BoxFit.cover,
                errorBuilder: (context, error, stackTrace) =>
                    _InitialMark(name: name),
                loadingBuilder: (context, child, progress) =>
                    progress == null ? child : _InitialMark(name: name),
              )
            : _InitialMark(name: name),
      ),
    );
  }
}

class _InitialMark extends StatelessWidget {
  const _InitialMark({required this.name});

  final String name;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    final trimmedName = name.trim();
    return ColoredBox(
      color: tokens.soft,
      child: Center(
        child: Text(
          trimmedName.isEmpty
              ? '?'
              : trimmedName.characters.first.toUpperCase(),
          style: TextStyle(
            color: context.appColors.success,
            fontWeight: FontWeight.w800,
          ),
        ),
      ),
    );
  }
}
