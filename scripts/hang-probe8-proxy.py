#!/usr/bin/env python3
"""THROWAWAY: CONNECT proxy whose first nodejs.org connection goes idle after 200 KB,
like the stalled connections seen in the Hermit hang. Later connections pass through."""
import asyncio, sys

state = {"stalled": False}
LIMIT = 200_000

async def copy(reader, writer, stall):
    total = 0
    try:
        while True:
            data = await reader.read(65536)
            if not data:
                break
            if stall and total + len(data) > LIMIT:
                writer.write(data[: max(0, LIMIT - total)])
                await writer.drain()
                print("proxy: going idle on the first nodejs.org connection", flush=True)
                await asyncio.sleep(10**6)
            total += len(data)
            writer.write(data)
            await writer.drain()
    except Exception:
        pass
    finally:
        try:
            writer.close()
        except Exception:
            pass

async def handle(cr, cw):
    try:
        line = await cr.readline()
        while (await cr.readline()) not in (b"\r\n", b""):
            pass
        host, port = line.split()[1].decode().rsplit(":", 1)
        ur, uw = await asyncio.open_connection(host, int(port))
        cw.write(b"HTTP/1.1 200 Connection established\r\n\r\n")
        await cw.drain()
        stall = host == "nodejs.org" and not state["stalled"]
        if stall:
            state["stalled"] = True
            print("proxy: first nodejs.org connection", flush=True)
        await asyncio.gather(copy(cr, uw, False), copy(ur, cw, stall))
    except Exception as err:
        print("proxy error", err, flush=True)

async def main():
    server = await asyncio.start_server(handle, "127.0.0.1", 8899)
    async with server:
        await server.serve_forever()

asyncio.run(main())
