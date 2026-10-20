PS2 controller port emulation, from Santroller (sanjay900/Santroller lib/psx_emulation, GPL-3.0, at 0662a9ff).
Unchanged apart from: the SubType names coming from lib/santroller_compat, no spi.hpp include, and pio_spi_init()
returning NULL instead of asserting when the PIO has no free state machines.
