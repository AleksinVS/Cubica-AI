#!/usr/bin/env python3
"""
Qdrant indexer for `manifest_published` events.

Dev usage: can accept precomputed vectors from event. In production,
plug your embedding provider and supply vectors before calling this tool.
"""