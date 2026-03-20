using FluentAssertions;
using RoadTripMap.Helpers;

namespace RoadTripMap.Tests.Helpers;

public class SlugHelperTests
{
    [Theory]
    [InlineData("My Road Trip!", "my-road-trip")]
    [InlineData("cross country 2026", "cross-country-2026")]
    [InlineData("Pacific---Coast", "pacific-coast")]
    [InlineData("---Leading", "leading")]
    [InlineData("Trailing---", "trailing")]
    [InlineData("ABC 123 XYZ", "abc-123-xyz")]
    public void GenerateSlug_ReturnsUrlFriendlySlug(string input, string expected)
    {
        // Arrange & Act
        var result = SlugHelper.GenerateSlug(input);

        // Assert
        result.Should().Be(expected);
    }

    [Fact]
    public void GenerateSlug_WithSpecialCharacters_RemovesThemAndReplacesWithHyphens()
    {
        // Arrange & Act
        var result = SlugHelper.GenerateSlug("Hello@World#Test!");

        // Assert
        result.Should().Be("hello-world-test");
    }

    [Fact]
    public void GenerateSlug_TruncatesLongNames()
    {
        // Arrange
        var longName = new string('a', 200);

        // Act
        var result = SlugHelper.GenerateSlug(longName);

        // Assert
        result.Length.Should().BeLessThanOrEqualTo(80);
    }

    [Fact]
    public void GenerateSlug_WithSpecialCharsOnly_ReturnsEmpty()
    {
        // Arrange & Act
        var result = SlugHelper.GenerateSlug("!@#$%");

        // Assert
        result.Should().Be("");
    }

    [Fact]
    public void GenerateSlug_WithWhitespaceOnly_ReturnsEmpty()
    {
        // Arrange & Act
        var result = SlugHelper.GenerateSlug("   ");

        // Assert
        result.Should().Be("");
    }

    [Fact]
    public async Task GenerateUniqueSlugAsync_WithNonExistingSlug_ReturnsSameSlug()
    {
        // Arrange
        Func<string, Task<bool>> slugExists = (string slug) => Task.FromResult(false); // Slug never exists

        // Act
        var result = await SlugHelper.GenerateUniqueSlugAsync("My Road Trip", slugExists);

        // Assert
        result.Should().Be("my-road-trip");
    }

    [Fact]
    public async Task GenerateUniqueSlugAsync_WithExistingSlug_AppendsSuffixNumber()
    {
        // Arrange
        var existingSlugs = new[] { "my-road-trip", "my-road-trip-2" };
        async Task<bool> SlugExists(string slug) => await Task.FromResult(existingSlugs.Contains(slug));

        // Act
        var result = await SlugHelper.GenerateUniqueSlugAsync("My Road Trip", SlugExists);

        // Assert
        result.Should().Be("my-road-trip-3");
    }

    [Fact]
    public async Task GenerateUniqueSlugAsync_WithEmptyBaseSlug_FallsBackToTrip()
    {
        // Arrange
        Task<bool> SlugExists(string slug) => Task.FromResult(false);

        // Act
        var result = await SlugHelper.GenerateUniqueSlugAsync("!@#$%", SlugExists);

        // Assert
        result.Should().Be("trip");
    }

    [Fact]
    public async Task GenerateUniqueSlugAsync_WhenTripExistsThenReturnsTrip2()
    {
        // Arrange
        var existingSlugs = new[] { "trip" };
        async Task<bool> SlugExists(string slug) => await Task.FromResult(existingSlugs.Contains(slug));

        // Act
        var result = await SlugHelper.GenerateUniqueSlugAsync("!@#$%", SlugExists);

        // Assert
        result.Should().Be("trip-2");
    }
}
