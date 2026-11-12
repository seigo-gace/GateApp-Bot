"""Compile-only test: force-lock script must be valid without running Telegram."""
import pathlib
import py_compile
import unittest


class ForceLockSyntax(unittest.TestCase):
    def test_force_lock_compiles(self):
        py_compile.compile(str(pathlib.Path(__file__).resolve().parent / "force_lock.py"), doraise=True)


if __name__ == "__main__":
    unittest.main()
