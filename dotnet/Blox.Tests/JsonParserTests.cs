using Blox.Data.Json;
using Xunit;

namespace Blox.Tests
{
    public class JsonParserTests
    {
        [Fact]
        public void ParsesScalarsArraysObjects()
        {
            var n = JsonParser.Parse("{\"a\": 1, \"b\": [true, false, null], \"c\": \"x\", \"d\": -2.5e2, \"e\": {}}");
            Assert.Equal(1, n["a"].AsInt);
            Assert.True(n["b"][0].AsBool);
            Assert.False(n["b"][1].AsBool);
            Assert.True(n["b"][2].IsNull);
            Assert.Equal("x", n["c"].AsString);
            Assert.Equal(-250.0, n["d"].AsDouble);
            Assert.Equal(0, n["e"].Count);
            Assert.Equal(new[] { "a", "b", "c", "d", "e" }, n.Keys);
        }

        [Fact]
        public void DecodesEscapesAndUnicode()
        {
            var n = JsonParser.Parse("\"q\\\" b\\\\ s\\/ n\\n t\\t u\\u00e9 \\ud83d\\ude00 Sint-Servaasbrug\"");
            Assert.Equal("q\" b\\ s/ n\n t\t ué \U0001F600 Sint-Servaasbrug", n.AsString);
        }

        [Fact]
        public void HandlesBomWhitespaceAndLargeIds()
        {
            var n = JsonParser.Parse("﻿ \r\n {\"id\": 4294967295, \"neg\": -0, \"f\": 0.125}\n");
            Assert.Equal(4294967295u, n["id"].AsUInt);
            Assert.Equal(0.125, n["f"].AsDouble);
        }

        [Theory]
        [InlineData("")]
        [InlineData("{")]
        [InlineData("[1,]")]
        [InlineData("{\"a\":1,}")]
        [InlineData("01")]
        [InlineData("1.")]
        [InlineData("-")]
        [InlineData("tru")]
        [InlineData("\"abc")]
        [InlineData("\"bad \\x escape\"")]
        [InlineData("\"ctrl \u0001\"")]
        [InlineData("{} extra")]
        [InlineData("// comment\n{}")]
        [InlineData("NaN")]
        public void RejectsMalformed(string text)
        {
            Assert.Throws<JsonException>(() => JsonParser.Parse(text));
        }

        [Fact]
        public void TypedAccessorsThrowOnMismatchAndMissing()
        {
            var n = JsonParser.Parse("{\"a\": \"x\", \"f\": 1.5}");
            Assert.Throws<JsonException>(() => n["a"].AsInt);
            Assert.Throws<JsonException>(() => n["f"].AsInt);
            Assert.Throws<JsonException>(() => n["missing"]);
            Assert.Null(n.OptString("missing"));
            Assert.True(n.Get("missing").IsNull);
        }

        [Fact]
        public void ErrorReportsLineAndColumn()
        {
            var e = Assert.Throws<JsonException>(() => JsonParser.Parse("{\n  \"a\": ?\n}"));
            Assert.Contains("line 2", e.Message);
        }

        [Fact]
        public void RejectsExcessiveNesting()
        {
            Assert.Throws<JsonException>(() => JsonParser.Parse(new string('[', 300) + new string(']', 300)));
        }
    }
}
