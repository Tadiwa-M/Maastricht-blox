#nullable enable
namespace Blox.Data
{
    /// <summary>
    /// Anything that holds the currently loaded world (in Unity: the Rendering WorldLoader).
    /// Gameplay code asks for the world through this interface, so Blox.Gameplay never has to
    /// reference Blox.Rendering (CLAUDE.md: gameplay must not depend on rendering).
    /// </summary>
    public interface IWorldSource
    {
        /// <summary>The loaded world, or null while nothing is loaded.</summary>
        WorldIndex? World { get; }
    }
}
