"""Moves the pointer on the X display and clicks. Used by demo.mjs to tap the real notification toast."""
import sys, time
from Xlib import X, display
from Xlib.ext import xtest
d = display.Display()
x, y = int(sys.argv[1]), int(sys.argv[2])
xtest.fake_input(d, X.MotionNotify, x=x, y=y); d.sync(); time.sleep(0.6)
if len(sys.argv) < 4:
    xtest.fake_input(d, X.ButtonPress, 1); d.sync(); time.sleep(0.08)
    xtest.fake_input(d, X.ButtonRelease, 1); d.sync()
