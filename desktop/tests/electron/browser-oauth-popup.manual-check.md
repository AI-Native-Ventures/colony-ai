# Coordinator check: Google sign-in popup

Run this check on a packaged Colony candidate. The owner completes the real
Google sign-in. Do not use a test account, read credentials, or record cookies
or tokens.

1. Launch the packaged candidate with a throwaway browser profile.
2. Open the built-in Browser tab and navigate to `https://www.pinterest.com/`.
3. Click Pinterest's **Continue with Google** button as the human user.
4. Confirm a separate sign-in window appears above Colony and remains open while
   Google is active. The Pinterest page should stay open in its original tab.
5. Have the owner complete sign-in. Confirm the sign-in window closes and
   Pinterest continues in the original tab.
6. Record the candidate version, operating system, whether the popup appeared,
   whether it closed, and whether Pinterest completed the return flow. Do not
   include account details, credentials, cookies, or tokens in the note.
