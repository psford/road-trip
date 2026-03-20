using System.Text.RegularExpressions;

namespace RoadTripMap.Helpers;

public static partial class SlugHelper
{
    public static string GenerateSlug(string name)
    {
        var slug = name.ToLowerInvariant();
        slug = NonAlphanumericRegex().Replace(slug, "-");
        slug = MultipleHyphensRegex().Replace(slug, "-");
        slug = slug.Trim('-');
        if (slug.Length > 80)
            slug = slug[..80].TrimEnd('-');
        return slug;
    }

    public static async Task<string> GenerateUniqueSlugAsync(
        string name, Func<string, Task<bool>> slugExists)
    {
        var baseSlug = GenerateSlug(name);
        if (string.IsNullOrEmpty(baseSlug))
            baseSlug = "trip";

        var slug = baseSlug;
        var counter = 2;
        while (await slugExists(slug))
        {
            slug = $"{baseSlug}-{counter}";
            counter++;
        }
        return slug;
    }

    [GeneratedRegex("[^a-z0-9]+")]
    private static partial Regex NonAlphanumericRegex();

    [GeneratedRegex("-{2,}")]
    private static partial Regex MultipleHyphensRegex();
}
