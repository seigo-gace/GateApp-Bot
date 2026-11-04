"""Ensure deployment helpers stay syntactically valid in the existing offline CI."""
import pathlib
import py_compile
import unittest


class DeploymentHelperSyntax(unittest.TestCase):
    def test_helpers_compile(self):
        root = pathlib.Path(__file__).resolve().parent
        for name in ("sync_compose.py", "prepare_runtime.py", "diagnose_state.py", "preflight_runtime.py", "cutover_and_verify.py"):
            with self.subTest(helper=name):
                py_compile.compile(str(root / name), doraise=True)


if __name__ == "__main__":
    unittest.main()
