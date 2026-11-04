"""Offline compile check for guarded live runtime readback."""
from pathlib import Path
import py_compile
import unittest

class LiveSyntax(unittest.TestCase):
    def test_live_checker_compiles(self):
        py_compile.compile(str(Path(__file__).resolve().parent/"verify_live.py"), doraise=True)
