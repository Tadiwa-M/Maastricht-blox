using System;
using Blox.Data;
using Blox.Meshing.Core;
using UnityEngine;

namespace Blox.Rendering
{
    /// <summary>
    /// Owns the global <c>_BloxStudTops</c> buffer (layout: <see cref="StudTopsLayout"/>), which
    /// tells Blox/BrickBody where to fake studs on top faces. 32 MB covering the whole 64 x 64
    /// chunk slice; each full-detail chunk writes its 8 KB range from its stud list.
    /// </summary>
    public sealed class StudTopsBuffer : IDisposable
    {
        private readonly GraphicsBuffer _buffer;
        private readonly ushort[] _tops = new ushort[StudTopsLayout.ColumnsPerChunk];
        private readonly uint[] _words = new uint[StudTopsLayout.WordsPerChunk];

        public StudTopsBuffer()
        {
            _buffer = new GraphicsBuffer(GraphicsBuffer.Target.Structured, StudTopsLayout.TotalWords, sizeof(uint)) { name = "Blox Stud Tops" };
            // Contents of a new buffer are undefined: clear once.
            _buffer.SetData(new uint[StudTopsLayout.TotalWords]);
            Shader.SetGlobalBuffer(BloxShaderGlobals.StudTops, _buffer);
            BloxShaderGlobals.SetStudTopsBound(true);
        }

        public void SetChunk(ChunkCoord c, StudInstance[] studs)
        {
            if (!StudTopsLayout.ChunkInRange(c.X, c.Y)) return;
            Array.Clear(_tops, 0, _tops.Length);
            foreach (var s in studs) StudTopsLayout.Accumulate(_tops, c.X, c.Y, s.X, s.Y, s.Z);
            StudTopsLayout.Pack(_tops, _words);
            _buffer.SetData(_words, 0, StudTopsLayout.WordOffset(c.X, c.Y), _words.Length);
        }

        public void ClearChunk(ChunkCoord c)
        {
            if (!StudTopsLayout.ChunkInRange(c.X, c.Y)) return;
            Array.Clear(_words, 0, _words.Length);
            _buffer.SetData(_words, 0, StudTopsLayout.WordOffset(c.X, c.Y), _words.Length);
        }

        public void Dispose()
        {
            BloxShaderGlobals.SetStudTopsBound(false);
            _buffer.Release();
        }
    }
}
