using AssetManagement.Core.Interfaces;
using AssetManagement.Infrastructure.Repositories;
using Microsoft.Extensions.DependencyInjection;

namespace AssetManagement.Infrastructure;

public static class DependencyInjection
{
    public static IServiceCollection AddInfrastructure(this IServiceCollection services)
    {
        services.AddSingleton<IAssetRepository, FakeAssetRepository>();
        return services;
    }
}
