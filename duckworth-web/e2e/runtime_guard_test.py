import os
import unittest
from unittest.mock import patch

from runtime_guard import sandbox_household_id, sandbox_origin, validate_sandbox_health


class RuntimeGuardTests(unittest.TestCase):
    def test_requires_an_explicit_sandbox_origin(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(RuntimeError, "DUCKWORTH_E2E_SANDBOX_ORIGIN"):
                sandbox_origin()

    def test_rejects_family_live_origin(self) -> None:
        with patch.dict(os.environ, {"DUCKWORTH_E2E_SANDBOX_ORIGIN": "http://127.0.0.1:4200"}, clear=True):
            with self.assertRaisesRegex(RuntimeError, "family-live"):
                sandbox_origin()

    def test_requires_a_non_family_household(self) -> None:
        with patch.dict(os.environ, {"DUCKWORTH_E2E_SANDBOX_HOUSEHOLD": "household-demo"}, clear=True):
            with self.assertRaisesRegex(RuntimeError, "disposable"):
                sandbox_household_id()

    def test_accepts_explicit_sandbox_target(self) -> None:
        with patch.dict(
            os.environ,
            {
                "DUCKWORTH_E2E_SANDBOX_ORIGIN": "http://127.0.0.1:4300",
                "DUCKWORTH_E2E_SANDBOX_HOUSEHOLD": "e2e-20260813-abc123",
            },
            clear=True,
        ):
            self.assertEqual(sandbox_origin(), "http://127.0.0.1:4300")
            self.assertEqual(sandbox_household_id(), "e2e-20260813-abc123")

    def test_requires_sandbox_health_handshake(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "lane=sandbox"):
            validate_sandbox_health({"status": "ok", "lane": "live", "instanceId": "live-1"})
        with self.assertRaisesRegex(RuntimeError, "instance ID"):
            validate_sandbox_health({"status": "ok", "lane": "sandbox"})
        validate_sandbox_health({"status": "ok", "lane": "sandbox", "instanceId": "e2e-1"})

    def test_accepts_only_the_expected_disposable_api_test_instance(self) -> None:
        with patch.dict(os.environ, {"DUCKWORTH_API_TEST_INSTANCE_ID": "api-test-expected"}, clear=True):
            validate_sandbox_health({
                "status": "ok", "lane": "api-test", "instanceId": "api-test-expected",
            })
            with self.assertRaisesRegex(RuntimeError, "instance identity"):
                validate_sandbox_health({
                    "status": "ok", "lane": "api-test", "instanceId": "api-test-other",
                })


if __name__ == "__main__":
    unittest.main()
