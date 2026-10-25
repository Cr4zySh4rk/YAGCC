// Force-included into YAGCC's own sources and vendored libraries (see CMakeLists.txt).
// No stdio driver (UART / USB CDC) is ever linked, so every printf() in this firmware, mostly debug traces in the
// vendored emulation libraries, writes into the void. Making the calls vanish stops the printf engine, stdio and
// their mutex from being linked in (about 8 KB). The `if (0)` keeps the arguments type-checked and "used".
#ifndef YACC_NOPRINTF_H
#define YACC_NOPRINTF_H
#include <stdio.h>
#define printf(...) do { if (0) (printf)(__VA_ARGS__); } while (0)
#endif
