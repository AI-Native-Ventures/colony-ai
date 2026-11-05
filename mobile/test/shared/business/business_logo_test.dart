import 'package:buzz/shared/business/business_logo.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('uses the business own domain for logo.dev', () {
    final source = businessLogoSource(
      website: ' HTTPS://WWW.Example.co.za:8443/about ',
      token: 'publishable-fixture',
    );

    expect(source, isNotNull);
    final uri = Uri.parse(source!);
    expect(uri.host, 'img.logo.dev');
    expect(uri.path, '/example.co.za');
    expect(uri.queryParameters['token'], 'publishable-fixture');
    expect(uri.queryParameters['size'], '64');
  });

  test('ignores shared hosts and uses stored media when available', () {
    expect(
      extractBusinessDomain('https://apexcom.co.za/pathways-guesthouse'),
      isNull,
    );
    expect(
      businessLogoSource(
        website: 'https://facebook.com/pathwaysguesthouse',
        logoUrl: 'https://images.example.org/pathways.png',
        token: 'publishable-fixture',
      ),
      'https://images.example.org/pathways.png',
    );
  });

  test(
    'uses the initial when media is missing or the selected image fails',
    () {
      expect(
        businessLogoSource(website: null, token: 'publishable-fixture'),
        isNull,
      );
      final source = businessLogoSource(
        website: 'https://example.com',
        token: 'publishable-fixture',
      );
      expect(shouldShowBusinessLogo(source, imageFailed: true), isFalse);
      expect(shouldShowBusinessLogo(source, imageFailed: false), isTrue);
    },
  );
}
