import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart' as http_testing;
import 'package:nostr/nostr.dart' as nostr;
import 'package:buzz/features/auth/account_api.dart';
import 'package:buzz/features/auth/account_auth_provider.dart';
import 'package:buzz/features/auth/account_auth_types.dart';
import 'package:buzz/features/auth/account_claim_status_provider.dart';
import 'package:buzz/features/auth/account_google_sign_in.dart';
import 'package:buzz/shared/auth/auth_provider.dart';
import 'package:buzz/shared/community/community.dart';
import 'package:buzz/shared/community/community_provider.dart';
import 'package:buzz/shared/community/community_storage.dart';

import '../../shared/community/community_storage_test.dart';

void main() {
  test(
    'signup records a retryable verification state without a session key',
    () async {
      late http.Request request;
      final container = _container((value) async {
        request = value;
        return http.Response('{"status":"verification_sent"}', 202);
      });
      addTearDown(container.dispose);

      await container
          .read(accountAuthProvider.notifier)
          .signUp(
            email: '  Person@Example.com ',
            password: 'generated-password-10',
          );

      expect(request.url.path, '/api/accounts/signup');
      expect(jsonDecode(request.body), {
        'email': 'person@example.com',
        'password': 'generated-password-10',
      });
      expect(
        container.read(accountAuthProvider).status,
        AccountAuthStatus.verificationSent,
      );
      expect(
        container.read(accountAuthProvider).codePurpose,
        AccountCodePurpose.verify,
      );
      expect(
        container.read(accountAuthProvider).toString(),
        isNot(contains('nsec')),
      );
    },
  );

  test(
    'verify persists the returned identity through auth secure storage',
    () async {
      final keys = nostr.Keys.generate();
      final storage = CommunityStorage(secure: FakeSecureStorage());
      final client = http_testing.MockClient(
        (_) async => http.Response(_sessionBody(keys), 200),
      );
      final container = _containerWithClient(client, storage: storage);
      addTearDown(container.dispose);
      await container.read(authProvider.future);

      await container
          .read(accountAuthProvider.notifier)
          .verifyCode(email: 'person@example.com', code: '123456');

      final saved = await storage.loadAll();
      expect(
        container.read(accountAuthProvider).status,
        AccountAuthStatus.complete,
      );
      expect(saved, hasLength(1));
      expect(saved.single.nsec, keys.nsec);
      expect(saved.single.pubkey, keys.public);
      expect(await storage.loadActiveId(), saved.single.id);
      expect(
        container.read(authProvider).value?.status,
        AuthStatus.authenticated,
      );
    },
  );

  test(
    'unverified signin moves to verification and invalid credentials stay explicit',
    () async {
      final queue = <http.Response>[
        http.Response('{"error":"email_unverified"}', 403),
        http.Response('{"error":"invalid_credentials"}', 401),
      ];
      final container = _container((_) async => queue.removeAt(0));
      addTearDown(container.dispose);

      final notifier = container.read(accountAuthProvider.notifier);
      await notifier.signIn(
        email: 'person@example.com',
        password: 'password-1234',
      );
      expect(
        container.read(accountAuthProvider).status,
        AccountAuthStatus.verificationSent,
      );
      expect(
        container.read(accountAuthProvider).codePurpose,
        AccountCodePurpose.verify,
      );

      await notifier.signIn(
        email: 'person@example.com',
        password: 'wrong-password',
      );
      expect(
        container.read(accountAuthProvider).status,
        AccountAuthStatus.failed,
      );
      expect(
        container.read(accountAuthProvider).failure?.kind,
        AccountAuthFailureKind.invalidCredentials,
      );
    },
  );

  test(
    'forgot-password request and confirmation use reset code flow',
    () async {
      final keys = nostr.Keys.generate();
      final bodies = <Map<String, dynamic>>[];
      final container = _container((request) async {
        if (request.url.path.endsWith('/reset/request')) {
          bodies.add(jsonDecode(request.body) as Map<String, dynamic>);
          return http.Response('{"status":"verification_sent"}', 202);
        }
        bodies.add(jsonDecode(request.body) as Map<String, dynamic>);
        return http.Response(_sessionBody(keys), 200);
      });
      addTearDown(container.dispose);
      await container.read(authProvider.future);

      final notifier = container.read(accountAuthProvider.notifier);
      await notifier.requestPasswordReset(email: 'Person@Example.com');
      expect(
        container.read(accountAuthProvider).codePurpose,
        AccountCodePurpose.reset,
      );
      await notifier.confirmPasswordReset(
        email: 'person@example.com',
        code: '123456',
        newPassword: 'new-password-10',
      );

      expect(bodies, [
        {'email': 'person@example.com'},
        {
          'email': 'person@example.com',
          'code': '123456',
          'new_password': 'new-password-10',
        },
      ]);
      expect(
        container.read(accountAuthProvider).status,
        AccountAuthStatus.complete,
      );
      expect(
        (await container.read(communityStorageProvider).loadAll()).single.nsec,
        keys.nsec,
      );
    },
  );

  test(
    'Google ID token goes to the relay and its returned key is persisted',
    () async {
      final keys = nostr.Keys.generate();
      late Map<String, dynamic> body;
      final container = _container((request) async {
        body = jsonDecode(request.body) as Map<String, dynamic>;
        return http.Response(_sessionBody(keys), 200);
      }, google: _FakeGoogleSignIn('generated-test-id-token'));
      addTearDown(container.dispose);
      await container.read(authProvider.future);

      await container.read(accountAuthProvider.notifier).continueWithGoogle();

      expect(body, {'id_token': 'generated-test-id-token'});
      expect(
        container.read(accountAuthProvider).status,
        AccountAuthStatus.complete,
      );
      expect(
        (await container.read(communityStorageProvider).loadAll()).single.nsec,
        keys.nsec,
      );
    },
  );

  test(
    'claim signs with the active identity and returns a verification state',
    () async {
      final keys = nostr.Keys.generate();
      final storage = CommunityStorage(secure: FakeSecureStorage());
      final community = Community.create(
        name: 'Relay',
        relayUrl: 'https://relay.example',
        pubkey: keys.public,
        nsec: keys.nsec,
      );
      await storage.save(community);
      await storage.saveActiveId(community.id);
      late http.Request request;
      final container = _containerWithClient(
        http_testing.MockClient((value) async {
          request = value;
          return http.Response('{"status":"verification_sent"}', 202);
        }),
        storage: storage,
      );
      addTearDown(container.dispose);
      await container.read(authProvider.future);

      await container
          .read(accountAuthProvider.notifier)
          .claimAccount(
            email: 'person@example.com',
            password: 'generated-password-10',
          );

      expect(
        request.url.toString(),
        'https://relay.example/api/accounts/claim',
      );
      expect(jsonDecode(request.body), {
        'email': 'person@example.com',
        'password': 'generated-password-10',
        'nsec': keys.nsec,
      });
      expect(request.headers['Authorization'], startsWith('Nostr '));
      expect(
        container.read(accountAuthProvider).status,
        AccountAuthStatus.verificationSent,
      );
    },
  );

  test(
    'storage errors remain a visible failure instead of a false sign-in',
    () async {
      final keys = nostr.Keys.generate();
      final failingStorage = _FailingCommunityStorage();
      final container = _container(
        (_) async => http.Response(_sessionBody(keys), 200),
        storage: failingStorage,
      );
      addTearDown(container.dispose);
      await container.read(authProvider.future);

      await container
          .read(accountAuthProvider.notifier)
          .signIn(
            email: 'person@example.com',
            password: 'generated-password-10',
          );

      expect(
        container.read(accountAuthProvider).status,
        AccountAuthStatus.failed,
      );
      expect(
        container.read(accountAuthProvider).failure?.kind,
        AccountAuthFailureKind.localStorage,
      );
      expect(
        container.read(authProvider).value?.status,
        AuthStatus.unauthenticated,
      );
    },
  );

  test(
    'link status reports an unclaimed identity without blocking it',
    () async {
      final keys = nostr.Keys.generate();
      final storage = CommunityStorage(secure: FakeSecureStorage());
      final community = Community.create(
        name: 'Relay',
        relayUrl: 'https://relay.example',
        pubkey: keys.public,
        nsec: keys.nsec,
      );
      await storage.save(community);
      await storage.saveActiveId(community.id);
      final container = _container(
        (_) async => http.Response('{"error":"account_not_found"}', 404),
        storage: storage,
      );
      addTearDown(container.dispose);

      final link = await container.read(accountLinkStatusProvider.future);

      expect(link.status, AccountLinkStatus.needsClaim);
      expect((await storage.loadAll()).single.nsec, keys.nsec);
    },
  );
}

ProviderContainer _container(
  Future<http.Response> Function(http.Request request) handler, {
  CommunityStorage? storage,
  AccountGoogleSignIn? google,
}) => _containerWithClient(
  http_testing.MockClient(handler),
  storage: storage,
  google: google,
);

ProviderContainer _containerWithClient(
  http.Client client, {
  CommunityStorage? storage,
  AccountGoogleSignIn? google,
}) => ProviderContainer(
  overrides: [
    accountHttpClientProvider.overrideWithValue(client),
    communityStorageProvider.overrideWithValue(
      storage ?? CommunityStorage(secure: FakeSecureStorage()),
    ),
    communitySnapshotWriterProvider.overrideWithValue((_) async {}),
    if (google != null) accountGoogleSignInProvider.overrideWithValue(google),
  ],
);

String _sessionBody(nostr.Keys keys) => jsonEncode({
  'account': {
    'id': 'account-test-id',
    'email': 'person@example.com',
    'pubkey': keys.public,
    'has_password': true,
    'google_linked': false,
  },
  'nsec': keys.nsec,
});

class _FakeGoogleSignIn implements AccountGoogleSignIn {
  _FakeGoogleSignIn(this.idToken);

  final String idToken;

  @override
  Future<String?> authenticateForIdToken() async => idToken;
}

class _FailingCommunityStorage extends CommunityStorage {
  @override
  Future<List<Community>> loadAll() async => [];

  @override
  Future<void> save(Community community) async {
    throw StateError('generated storage failure');
  }
}
